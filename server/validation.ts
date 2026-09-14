import { z } from 'zod';
import { normalizeUrl } from './security.js';
export const id = z.coerce.number().int().positive().max(4294967295);
const name = z.string().trim().min(1).max(120);
export const paging = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().max(200).default(''),
});
export const topicInput = z.object({
  name,
  note: z.string().trim().max(10000).default(''),
  enabled: z.boolean().default(true),
});
export const username = z
  .string()
  .trim()
  .min(3)
  .max(80)
  .regex(/^[a-zA-Z0-9_.@-]+$/);
export const password = z
  .string()
  .min(12)
  .max(72)
  .refine((v) => Buffer.byteLength(v) <= 72, '密码 UTF-8 编码不能超过 72 字节');
export const adminInput = z.object({ username, password });
export const callerInput = z.object({ name });
export const subscriberInput = z
  .object({
    name,
    key: z
      .string()
      .trim()
      .regex(/^[a-zA-Z0-9_-]{8,200}$/)
      .optional(),
    enabled: z.boolean().default(true),
    allTopics: z.boolean(),
    topicIds: z.array(id).max(500).default([]),
  })
  .refine((v) => v.allTopics || v.topicIds.length > 0, '请选择热点或订阅全部');
export const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const d = new Date(v + 'T00:00:00Z');
    return !Number.isNaN(d.valueOf()) && d.toISOString().slice(0, 10) === v && v >= '1000-01-01';
  }, '日期无效');
export const articleInput = z.object({
  topicId: id,
  date,
  title: z.string().trim().min(1).max(500),
  aiSummary: z.string().max(12000).default(''),
  content: z.string().trim().min(1).max(200000),
  heatScore: z
    .number()
    .finite()
    .min(0)
    .max(100)
    .refine((v) => Math.round(v * 100) / 100 === v, '热度评分最多保留两位小数'),
  url: z
    .string()
    .trim()
    .min(1)
    .max(2048)
    .transform((v, ctx) => {
      try {
        const result = normalizeUrl(v);
        if (Buffer.byteLength(result) > 2048) throw Error();
        return result;
      } catch {
        ctx.addIssue({ code: 'custom', message: '链接无效或过长，仅支持 HTTP/HTTPS' });
        return z.NEVER;
      }
    }),
});
export const articleBatchInput = z.object({
  articles: z.array(articleInput).min(1).max(10),
});
export type ArticleInput = z.infer<typeof articleInput>;
export function like(value: string) {
  return '%' + value.replace(/[!%_]/g, '!$&') + '%';
}
