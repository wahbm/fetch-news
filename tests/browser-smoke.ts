import { chromium, expect } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import bcrypt from 'bcryptjs';
import assert from 'node:assert/strict';
import { createDB, rows, run } from '../server/db.js';
import { migrate } from '../server/migrate.js';
import { createApp } from '../server/app.js';
import { NotificationWorker } from '../server/worker.js';
import type { WecomMessage } from '../server/security.js';
if (!process.env.DB_NAME?.endsWith('_test'))
  throw Error('Browser tests require an isolated *_test database; its data is cleared.');
const pool = createDB();
await migrate(pool);
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
])
  await run(pool, `DELETE FROM ${t}`);
const password = randomBytes(18).toString('base64url');
await run(pool, 'INSERT INTO admins(username,password_hash) VALUES (?,?)', [
  'browser-admin',
  await bcrypt.hash(password, 4),
]);
const encryptionKey = randomBytes(32);
const base = process.env.APP_BASE_PATH || '/';
const app = await createApp(
  pool,
  {
    host: '127.0.0.1',
    port: 0,
    base,
    production: false,
    secureCookie: false,
    encryptionKey,
    worker: false,
  },
  false,
);
const address = await app.listen({ host: '127.0.0.1', port: 0 });
const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.CHROME_PATH ||
    (process.platform === 'darwin'
      ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
      : undefined),
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
try {
  await page.goto(address + base);
  await page.getByLabel('管理员账号').fill('browser-admin');
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.getByRole('heading', { name: '每个变化，都值得被看见' }).waitFor();
  await page.getByRole('menuitem', { name: '追踪热点' }).click();
  await page.getByRole('button', { name: '新增热点' }).click();
  await page.getByLabel('热点名称').fill('web3');
  await page.getByLabel('采集备注').fill('只需要查看 Ethereum 网络的热点');
  await page.getByRole('button', { name: '确 定' }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.getByText('只需要查看 Ethereum 网络的热点', { exact: true }).waitFor();
  await page.getByRole('menuitem', { name: '调用方' }).click();
  await page.getByRole('button', { name: '创建调用方', exact: true }).click();
  await page.getByLabel('名称', { exact: true }).fill('资讯采集服务');
  await page.getByRole('button', { name: '确 定' }).click();
  await page.locator('.secret-display').waitFor();
  const key = (await page.locator('.secret-display').innerText()).trim();
  assert.ok(key.startsWith('pn_'));
  await page.getByRole('button', { name: '我已保存' }).click();
  await page.getByRole('menuitem', { name: '订阅通知' }).click();
  await page.getByRole('button', { name: '创建订阅方', exact: true }).click();
  await page.getByLabel('订阅方名称').fill('产品研究组');
  await page.getByLabel('企业微信机器人 key', { exact: true }).fill('browser-mocked-wecom-key');
  await page.getByRole('button', { name: '确 定' }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.getByText('产品研究组', { exact: true }).waitFor();
  const apiPrefix = address + base + 'api/v1';
  const topicResponse = await fetch(apiPrefix + '/topics', {
    headers: { authorization: 'Bearer ' + key },
  });
  const topics = (await topicResponse.json()) as any;
  assert.equal(topics.items[0].note, '只需要查看 Ethereum 网络的热点');
  const ingest = () =>
    fetch(apiPrefix + '/articles', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + key, 'content-type': 'application/json' },
      body: JSON.stringify({
        topicId: topics.items[0].id,
        date: '2026-09-13',
        title: 'Ethereum 生态观察：扩容进展与应用动态',
        aiSummary:
          '本期关注 Ethereum 网络扩容与开发者生态。整理近期公开动态，帮助团队持续跟进有价值的变化。',
        content:
          '这是用于浏览器验收的示例内容。\n\n<script>window.__unsafe = true</script>\n正文以纯文本展示，不执行脚本。',
        heatScore: 92,
        url: 'https://example.com/ethereum-update',
      }),
    });
  assert.equal((await ingest()).status, 201);
  assert.equal((await ingest()).status, 200);
  const [count] = await rows(pool, 'SELECT COUNT(*) AS n FROM notifications');
  assert.equal(count.n, 1);
  await page.getByRole('menuitem', { name: '热点信息' }).click();
  await page.getByRole('button', { name: 'Ethereum 生态观察：扩容进展与应用动态' }).waitFor();
  await page.getByPlaceholder('搜索标题、总结或内容').fill('扩容');
  await page.getByPlaceholder('搜索标题、总结或内容').press('Enter');
  await page.getByRole('button', { name: 'Ethereum 生态观察：扩容进展与应用动态' }).click();
  await page.getByText('<script>window.__unsafe = true</script>', { exact: false }).waitFor();
  assert.equal(await page.evaluate(() => Reflect.get(window, '__unsafe')), undefined);
  await page.locator('.ant-drawer-close').click();
  await mkdir('docs/screenshots', { recursive: true });
  await page.screenshot({
    path: 'docs/screenshots/articles.png',
    fullPage: true,
    animations: 'disabled',
  });
  const sent: WecomMessage[] = [];
  await new NotificationWorker(pool, encryptionKey, async (_key, content) => {
    sent.push(content);
    return { ok: true };
  }).tick();
  assert.equal(sent.length, 1);
  await page.getByRole('menuitem', { name: '投递记录' }).click();
  await page.getByText('已发送', { exact: true }).waitFor();
  await page.getByRole('button', { name: '详情', exact: true }).click();
  await page.getByRole('cell', { name: '成功', exact: true }).waitFor();
  await page.locator('.ant-drawer-close').click();
  await page.getByRole('menuitem', { name: '管理员' }).click();
  await page.getByRole('cell', { name: 'browser-admin', exact: false }).waitFor();
  await page.getByRole('menuitem', { name: '工作概览' }).click();
  await page.getByText('Ethereum 生态观察：扩容进展与应用动态', { exact: true }).waitFor();
  await page.screenshot({
    path: 'docs/screenshots/overview.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.goto(address + base + 'articles');
  await page.getByRole('heading', { name: '热点信息', exact: true }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.ant-layout-sider')).toHaveCSS('width', '68px');
  await page.screenshot({
    path: 'docs/screenshots/mobile.png',
    fullPage: true,
    animations: 'disabled',
  });
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
    false,
  );
  await page.getByRole('button', { name: '退出登录' }).click();
  await page.getByRole('heading', { name: '登录管理后台' }).waitFor();
  assert.deepEqual(errors, []);
  console.log(
    'Browser flow passed: login → topic → caller → subscriber → API ingestion/dedup → search/detail → mock notification → deep link → mobile → logout.',
  );
} finally {
  await browser.close();
  await app.close();
  await pool.end();
}
