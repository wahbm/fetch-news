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
export function safeMarkdown(value: string) {
  return value.replace(/[\\`*_\[\]()<>#]/g, ' ').replace(/\r/g, '');
}
export function notificationMarkdown(a: {
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
  const score = typeof a.heatScore === 'number' ? `\n> AI 热度：${a.heatScore}` : '';
  const header = `**${clipUtf8(safeMarkdown(a.title), 700)}**\n> 热点：${safeMarkdown(a.topic)}\n> 日期：${a.date}${score}\n\n`;
  const footer = `\n\n[查看原文](${link})`;
  const budget = 4096 - Buffer.byteLength(header + footer);
  const summary = safeMarkdown(a.summary || '暂无 AI 总结，请查看原文。');
  return (
    header +
    (Buffer.byteLength(summary) > budget
      ? clipUtf8(summary, budget - 18) + '…（已截断）'
      : summary) +
    footer
  );
}
