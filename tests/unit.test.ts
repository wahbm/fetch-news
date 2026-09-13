import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import {
  normalizeUrl,
  encrypt,
  decrypt,
  clipUtf8,
  notificationMarkdown,
} from '../server/security.js';
import { articleInput, date, password } from '../server/validation.js';
import { sendWecom } from '../server/worker.js';
test('URL normalization preserves query/path and drops fragment', () => {
  assert.equal(normalizeUrl('HTTPS://EXAMPLE.COM:443/A?q=1#section'), 'https://example.com/A?q=1');
  assert.throws(() => normalizeUrl('javascript:alert(1)'));
  assert.throws(() => normalizeUrl('https://user:pass@example.com'));
});
test('AES-GCM authenticates encrypted webhook credentials', () => {
  const key = randomBytes(32);
  const value = encrypt('test-webhook', key);
  assert.equal(decrypt(value, key), 'test-webhook');
  assert.notEqual(value, encrypt('test-webhook', key));
  assert.throws(() => decrypt(value, randomBytes(32)));
});
test('notifications respect UTF-8 byte budget and escape user markdown', () => {
  const text = notificationMarkdown({
    title: '<@all> [攻击](https://x.test)',
    topic: '医药',
    date: '2026-09-13',
    summary: '中文🙂'.repeat(10000),
    url: 'https://example.com/' + 'x'.repeat(1950) + '(abc)',
  });
  assert.ok(Buffer.byteLength(text) <= 4096);
  assert.ok(!text.includes('<@all>'));
  assert.ok(text.includes('%28abc%29'));
  assert.ok(!clipUtf8('🙂🙂', 5).includes('�'));
  assert.equal(clipUtf8('🙂🙂', 5), '🙂');
});
test('validates real calendar dates, payload boundaries and passwords', () => {
  assert.equal(date.safeParse('2026-02-29').success, false);
  assert.equal(date.safeParse('2024-02-29').success, true);
  assert.equal(password.safeParse('中'.repeat(25)).success, false);
  assert.equal(
    articleInput.safeParse({
      topicId: 1,
      date: '2026-09-13',
      title: 'x',
      content: 'hello',
      url: 'file:///etc/passwd',
    }).success,
    false,
  );
});
test('WeCom sender never stores response bodies or secrets and classifies outcomes', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ errcode: 0 }));
    assert.deepEqual(await sendWecom('private-key', 'hi'), { ok: true });
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ errcode: 93000, errmsg: 'private-key' }));
    const invalid = await sendWecom('private-key', 'hi');
    assert.equal(invalid.permanent, true);
    assert.ok(!JSON.stringify(invalid).includes('private-key'));
    globalThis.fetch = async () => new Response(JSON.stringify({ errcode: 45009 }));
    assert.equal((await sendWecom('private-key', 'hi')).permanent, false);
    globalThis.fetch = async () => {
      throw Error('https://weixin.qq.com?key=private-key');
    };
    assert.ok(!(await sendWecom('private-key', 'hi')).error?.includes('private-key'));
  } finally {
    globalThis.fetch = original;
  }
});
