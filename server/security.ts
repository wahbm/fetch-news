import { createHash, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
export const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export const secret = () => randomBytes(32).toString('base64url');
export function encrypt(value: string, key: Buffer) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((b) => b.toString('base64')).join('.');
}
export function decrypt(value: string, key: Buffer) {
  const [iv, tag, content] = value.split('.').map((v) => Buffer.from(v, 'base64'));
  const cipher = createDecipheriv('aes-256-gcm', key, iv);
  cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(content), cipher.final()]).toString('utf8');
}
export function normalizeUrl(value: string) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    throw new Error('链接必须是无账号密码的 HTTP/HTTPS 地址');
  url.hash = '';
  return url.toString().replace(/\(/g, '%28').replace(/\)/g, '%29');
}
export function clipUtf8(value: string, max: number) {
  let out = '';
  let size = 0;
  for (const char of value) {
    const n = Buffer.byteLength(char);
    if (size + n > max) break;
    size += n;
    out += char;
  }
  return out;
}
export type WecomNewsMessage = {
  msgtype: 'news';
  news: {
    articles: [{ title: string; description: string; url: string }];
  };
};
export type WecomTextMessage = {
  msgtype: 'text';
  text: { content: string };
};
export type WecomMessage = WecomNewsMessage | WecomTextMessage;
export function safeWecomText(value: string) {
  return value.replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim();
}
export function notificationNews(a: {
  topic: string;
  date: string;
  title: string;
  summary: string;
  url: string;
  heatScore?: number;
}) {
  const link = a.url
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/</g, '%3C')
    .replace(/>/g, '%3E');
  const title = clipUtf8(safeWecomText(a.title) || '热点更新', 128);
  const topic = clipUtf8(safeWecomText(a.topic) || '未命名热点', 100);
  const summary = safeWecomText(a.summary || '暂无 AI 总结，请打开原文查看。');
  const score = typeof a.heatScore === 'number' ? `AI 热度：${a.heatScore}` : '';
  const description = clipUtf8(
    [`热点：${topic}`, `日期：${a.date}`, score, summary].filter(Boolean).join(' · '),
    512,
  );
  return {
    msgtype: 'news' as const,
    news: { articles: [{ title, description, url: link }] },
  } satisfies WecomNewsMessage;
}
export function testNotificationText(): WecomTextMessage {
  return {
    msgtype: 'text',
    text: { content: '热点追踪测试通知\n机器人连接成功，可以接收热点更新。' },
  };
}
