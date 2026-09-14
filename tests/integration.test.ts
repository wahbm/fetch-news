import { before, beforeEach, after, test } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { createDB, rows, run, transaction } from '../server/db.js';
import { migrate } from '../server/migrate.js';
import { createApp } from '../server/app.js';
import { hash } from '../server/security.js';
import type { WecomMessage } from '../server/security.js';
import { NotificationWorker } from '../server/worker.js';
if (!process.env.DB_NAME?.endsWith('_test'))
  throw Error(
    'Integration tests require an isolated DB_NAME ending in _test. Tests delete data in this database.',
  );
const pool = createDB();
const encryptionKey = randomBytes(32);
let app: Awaited<ReturnType<typeof createApp>>;
let cookie = '';
const password = 'test-password-strong';
const admin = (method: any, url: string, payload?: any) =>
  app.inject({
    method,
    url: '/api/admin' + url,
    payload,
    headers: { cookie, 'x-requested-with': 'PulseAdmin' },
  });
const caller = (method: any, url: string, payload?: any, key = 'pn_test-key') =>
  app.inject({
    method,
    url: '/api/v1' + url,
    payload,
    headers: { authorization: 'Bearer ' + key },
  });
const article = (topicId = 1, url = 'https://example.com/news#fragment', heatScore = 80) => ({
  topicId,
  date: '2026-09-13',
  title: '以太坊网络更新',
  aiSummary: '中文 AI 总结',
  content: '这里是正文 <script>alert(1)</script>',
  heatScore,
  url,
});
async function subscriber(allTopics = true, topicIds: number[] = [], key = 'mock-webhook-key') {
  const r = await admin('POST', '/subscribers', {
    name: '测试订阅',
    key,
    enabled: true,
    allTopics,
    topicIds,
  });
  assert.equal(r.statusCode, 201, r.body);
  return r.json().id;
}
before(async () => {
  await migrate(pool);
  await migrate(pool);
  app = await createApp(
    pool,
    {
      host: '127.0.0.1',
      port: 3000,
      base: '/',
      production: false,
      secureCookie: false,
      encryptionKey,
      worker: false,
    },
    false,
  );
  await app.ready();
});
beforeEach(async () => {
  await app.close();
  app = await createApp(
    pool,
    {
      host: '127.0.0.1',
      port: 3000,
      base: '/',
      production: false,
      secureCookie: false,
      encryptionKey,
      worker: false,
    },
    false,
  );
  await app.ready();
  const db = await pool.getConnection();
  try {
    for (const t of [
      'notification_attempts',
      'notifications',
      'subscriber_topics',
      'subscribers',
      'articles',
      'callers',
      'topics',
      'sessions',
      'admins',
    ]) {
      await run(db, `DELETE FROM ${t}`);
      await run(db, `ALTER TABLE ${t} AUTO_INCREMENT=1`);
    }
  } finally {
    db.release();
  }
  await run(pool, 'INSERT INTO admins(username,password_hash) VALUES (?,?)', [
    'admin',
    await bcrypt.hash(password, 4),
  ]);
  await run(
    pool,
    "INSERT INTO topics(name,note) VALUES ('web3','只看 Ethereum 网络'),('医药','临床研究')",
  );
  await run(pool, "INSERT INTO callers(name,key_hash,key_prefix) VALUES ('采集器',?,'pn_test')", [
    hash('pn_test-key'),
  ]);
  const login = await admin('POST', '/login', { username: 'admin', password });
  assert.equal(login.statusCode, 200, login.body);
  cookie = login.headers['set-cookie']!.toString().split(';')[0];
});
after(async () => {
  await app?.close();
  await pool.end();
});
test('auth boundaries, CSRF, logout and caller key rotation', async () => {
  assert.equal((await app.inject('/api/admin/me')).statusCode, 401);
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/admin/topics',
        headers: { cookie },
        payload: { name: 'bad' },
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (await app.inject({ url: '/api/admin/me', headers: { authorization: 'Bearer pn_test-key' } }))
      .statusCode,
    401,
  );
  assert.equal((await app.inject({ url: '/api/v1/topics', headers: { cookie } })).statusCode, 401);
  const rotated = await admin('POST', '/callers/1/reset-key');
  assert.equal(rotated.statusCode, 200);
  assert.equal((await caller('GET', '/topics')).statusCode, 401);
  assert.equal((await caller('GET', '/topics', undefined, rotated.json().key)).statusCode, 200);
  await admin('PATCH', '/callers/1', { enabled: false });
  assert.equal((await caller('GET', '/topics', undefined, rotated.json().key)).statusCode, 401);
  await admin('POST', '/logout');
  assert.equal((await admin('GET', '/me')).statusCode, 401);
});
test('last active admin cannot be disabled, including concurrent requests', async () => {
  assert.equal((await admin('PATCH', '/admins/1', { enabled: false })).statusCode, 409);
  assert.equal((await admin('POST', '/admins', { username: 'second', password })).statusCode, 201);
  const responses = await Promise.all([
    admin('PATCH', '/admins/1', { enabled: false }),
    admin('PATCH', '/admins/2', { enabled: false }),
  ]);
  assert.equal(responses.filter((r) => r.statusCode === 200).length, 1);
  const [count] = await rows(pool, 'SELECT COUNT(*) AS n FROM admins WHERE enabled=1');
  assert.equal(count.n, 1);
});
test('password reset and disabling revoke sessions', async () => {
  await admin('POST', '/admins/1/password', { password: 'changed-password-strong' });
  assert.equal((await admin('GET', '/me')).statusCode, 401);
  assert.equal((await admin('POST', '/login', { username: 'admin', password })).statusCode, 401);
});
test('topic validation, pagination and note search', async () => {
  assert.equal((await admin('POST', '/topics', { name: ' web3 ', note: '' })).statusCode, 409);
  const topicPage = await caller('GET', '/topics?pageSize=1');
  assert.equal(topicPage.json().items.length, 1);
  assert.equal(topicPage.json().items[0].note, '只看 Ethereum 网络');
  const search = await admin('GET', '/topics?q=Ethereum');
  assert.equal(search.json().total, 1);
  assert.equal((await caller('GET', '/topics?pageSize=101')).statusCode, 400);
});
test('concurrent duplicate ingestion produces one article and one task per matched subscriber', async () => {
  await subscriber(true);
  await subscriber(false, [1], 'other-mock-key');
  await subscriber(false, [2], 'unmatched-key');
  const responses = await Promise.all(
    Array.from({ length: 8 }, () => caller('POST', '/articles', article())),
  );
  assert.equal(
    responses.filter((r) => r.statusCode === 201).length,
    1,
    responses.map((r) => r.body).join('\n'),
  );
  assert.equal(
    responses.filter((r) => r.statusCode === 200).length,
    7,
    responses.map((r) => `${r.statusCode} ${r.body}`).join('\n'),
  );
  const [count] = await rows(pool, 'SELECT COUNT(*) AS n FROM notifications');
  assert.equal(count.n, 2);
  assert.equal((await caller('POST', '/articles', article(2))).statusCode, 201);
  await admin('PUT', '/topics/1', { name: 'web3', note: '', enabled: false });
  assert.equal((await caller('POST', '/articles', article())).statusCode, 200);
  assert.equal(
    (await caller('POST', '/articles', article(1, 'https://example.com/new'))).statusCode,
    409,
  );
  assert.equal((await caller('GET', '/topics')).json().total, 1);
});
test('batch ingestion accepts at most ten and notifies only its top three scores', async () => {
  await subscriber(true);
  const scores = [25, 95, 70, 80];
  const r = await caller('POST', '/articles/batch', {
    articles: scores.map((heatScore, i) =>
      article(1, `https://example.com/batch-${i}`, heatScore),
    ),
  });
  assert.equal(r.statusCode, 201, r.body);
  assert.equal(r.json().created, 4);
  assert.equal(r.json().notified, 3);
  assert.equal(r.json().items.filter((x: any) => x.notified).length, 3);
  const notified = await rows(
    pool,
    'SELECT a.heat_score FROM notifications n JOIN articles a ON a.id=n.article_id ORDER BY a.heat_score DESC',
  );
  assert.deepEqual(notified.map((x) => Number(x.heat_score)), [95, 80, 70]);
  const tooMany = await caller('POST', '/articles/batch', {
    articles: Array.from({ length: 11 }, (_, i) =>
      article(1, `https://example.com/too-many-${i}`, i),
    ),
  });
  assert.equal(tooMany.statusCode, 400);
});
test('invalid submissions rejected; Chinese search/date filters preserve safe raw text', async () => {
  assert.equal(
    (await caller('POST', '/articles', { ...article(), date: '2026-02-30' })).statusCode,
    400,
  );
  assert.equal(
    (await caller('POST', '/articles', { ...article(), url: 'javascript:alert(1)' })).statusCode,
    400,
  );
  assert.equal((await caller('POST', '/articles', article(999))).statusCode, 404);
  await caller('POST', '/articles', article());
  const found = await admin(
    'GET',
    '/articles?q=' + encodeURIComponent('正文') + '&from=2026-09-13&to=2026-09-13',
  );
  assert.equal(found.json().total, 1);
  const detail = await admin('GET', '/articles/1');
  assert.ok(detail.json().content.includes('<script>'));
  assert.equal((await admin('GET', '/articles?q=%25')).json().total, 0);
  assert.equal((await admin('GET', '/articles?from=2026-09-14&to=2026-09-13')).statusCode, 400);
});
test('transaction rollback leaves no partial article', async () => {
  await assert.rejects(
    transaction(pool, async (db) => {
      await run(
        db,
        'INSERT INTO articles(topic_id,caller_id,article_date,title,ai_summary,content,url,url_hash) VALUES (1,1,?,?,?,?,?,?)',
        ['2026-09-13', 't', '', 'body', 'https://example.com', hash('https://example.com')],
      );
      await run(db, 'INSERT INTO notifications(subscriber_id,article_id) VALUES (999,1)');
    }),
  );
  const [count] = await rows(pool, 'SELECT COUNT(*) AS n FROM articles');
  assert.equal(count.n, 0);
});
test('subscriber keys are encrypted, unique, never returned; scope changes do not backfill', async () => {
  const id = await subscriber(false, [1]);
  const [s] = await rows(pool, 'SELECT * FROM subscribers WHERE id=?', [id]);
  assert.ok(!s.key_cipher.includes('mock-webhook-key'));
  assert.ok(!(await admin('GET', '/subscribers')).body.includes('mock-webhook-key'));
  assert.equal(
    (await admin('POST', '/subscribers', { name: 'dup', key: 'mock-webhook-key', allTopics: true }))
      .statusCode,
    409,
  );
  await caller('POST', '/articles', article(2));
  await admin('PUT', `/subscribers/${id}`, { name: 'changed', allTopics: true, enabled: true });
  const [count] = await rows(pool, 'SELECT COUNT(*) AS n FROM notifications');
  assert.equal(count.n, 0);
});
test('test messages use queue; disabling cancels pending tasks', async () => {
  const id = await subscriber();
  const r = await admin('POST', `/subscribers/${id}/test`);
  assert.equal(r.statusCode, 202);
  await admin('PUT', `/subscribers/${id}`, { name: 'disabled', allTopics: true, enabled: false });
  const [n] = await rows(pool, 'SELECT status FROM notifications WHERE id=?', [r.json().id]);
  assert.equal(n.status, 'cancelled');
  assert.equal((await admin('POST', `/subscribers/${id}/test`)).statusCode, 409);
});
test('worker sends, rate limits per robot and prevents duplicate workers', async () => {
  const id = await subscriber();
  await caller('POST', '/articles', article());
  await admin('POST', `/subscribers/${id}/test`);
  const deliveries: WecomMessage[] = [];
  const sender = async (_key: string, message: WecomMessage) => {
    deliveries.push(message);
    return { ok: true };
  };
  const w1 = new NotificationWorker(pool, encryptionKey, sender);
  const w2 = new NotificationWorker(pool, encryptionKey, sender);
  await Promise.all([w1.tick(), w2.tick()]);
  await w1.tick();
  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0].msgtype, 'news');
  if (deliveries[0].msgtype === 'news') {
    assert.ok(deliveries[0].news.articles[0].title.includes('以太坊'));
    assert.ok(deliveries[0].news.articles[0].url.includes('example.com'));
  }
  await run(pool, 'UPDATE subscribers SET next_send_at=NULL');
  await w1.tick();
  assert.equal(deliveries.length, 2);
  assert.equal(deliveries[1].msgtype, 'text');
  if (deliveries[1].msgtype === 'text') assert.ok(deliveries[1].text.content.includes('测试通知'));
  const [n] = await rows(pool, "SELECT COUNT(*) AS n FROM notifications WHERE status='sent'");
  assert.equal(n.n, 2);
});
test('transient failures retry five times, manual retry preserves attempt history', async () => {
  const id = await subscriber();
  await admin('POST', `/subscribers/${id}/test`);
  const worker = new NotificationWorker(pool, encryptionKey, async () => ({
    ok: false,
    error: '模拟网络失败',
  }));
  for (let i = 1; i <= 5; i++) {
    await worker.tick();
    const [n] = await rows(pool, 'SELECT * FROM notifications');
    assert.equal(n.attempts, i);
    assert.equal(n.status, i === 5 ? 'failed' : 'retry');
    await run(pool, 'UPDATE subscribers SET next_send_at=NULL');
    await run(pool, 'UPDATE notifications SET next_attempt_at=UTC_TIMESTAMP(3)');
  }
  assert.equal((await admin('POST', '/notifications/1/retry')).statusCode, 200);
  const [n] = await rows(pool, 'SELECT * FROM notifications');
  assert.equal(n.generation, 2);
  assert.equal(n.attempts, 0);
  assert.equal((await admin('GET', '/notifications/1/attempts')).json().length, 5);
});
test('permanent errors fail immediately and stale worker leases recover after restart', async () => {
  const id = await subscriber();
  await admin('POST', `/subscribers/${id}/test`);
  const worker = new NotificationWorker(pool, encryptionKey, async () => ({
    ok: false,
    permanent: true,
    error: '企业微信错误码 93000',
  }));
  await worker.tick();
  let [n] = await rows(pool, 'SELECT * FROM notifications');
  assert.equal(n.status, 'failed');
  assert.equal(n.attempts, 1);
  await admin('POST', '/notifications/1/retry');
  await run(
    pool,
    "UPDATE notifications SET status='sending',attempts=1,lease_until=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 SECOND)",
  );
  await run(
    pool,
    "INSERT INTO notification_attempts(notification_id,generation,attempt,outcome) VALUES (1,2,1,'sending')",
  );
  const restarted = new NotificationWorker(pool, encryptionKey, async () => ({ ok: true }));
  await restarted.tick();
  [n] = await rows(pool, 'SELECT * FROM notifications');
  assert.equal(n.status, 'retry');
  const [a] = await rows(
    pool,
    'SELECT outcome FROM notification_attempts ORDER BY id DESC LIMIT 1',
  );
  assert.equal(a.outcome, 'unknown');
  await run(pool, 'UPDATE subscribers SET next_send_at=NULL');
  await run(pool, 'UPDATE notifications SET next_attempt_at=UTC_TIMESTAMP(3)');
  await restarted.tick();
  [n] = await rows(pool, 'SELECT * FROM notifications');
  assert.equal(n.status, 'sent');
});
test('subpath routing and authenticated OpenAPI docs', async () => {
  const sub = await createApp(
    pool,
    {
      host: '127.0.0.1',
      port: 3000,
      base: '/tester/fetch-news/',
      production: false,
      secureCookie: false,
      encryptionKey,
      worker: false,
    },
    false,
  );
  try {
    assert.equal((await sub.inject('/tester/fetch-news/health')).statusCode, 200);
    assert.equal((await sub.inject('/api/v1/topics')).statusCode, 404);
    assert.equal(
      (
        await sub.inject({
          url: '/tester/fetch-news/api/v1/topics',
          headers: { authorization: 'Bearer pn_test-key' },
        })
      ).statusCode,
      200,
    );
    assert.equal((await sub.inject('/tester/fetch-news/api/docs/json')).statusCode, 401);
    const response = await sub.inject({
      url: '/tester/fetch-news/api/docs/json',
      headers: { cookie },
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.ok(response.json().paths['/api/v1/topics']);
  } finally {
    await sub.close();
  }
});

test('login requests are rate limited', async () => {
  let response;
  for (let i = 0; i < 10; i++) {
    response = await admin('POST', '/login', { username: 'admin', password: 'incorrect-password' });
  }
  assert.equal(response!.statusCode, 429);
  assert.ok(response!.headers['retry-after']);
});
