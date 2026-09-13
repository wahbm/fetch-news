import Fastify, { type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUI from '@fastify/swagger-ui';
import staticFiles from '@fastify/static';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import bcrypt from 'bcryptjs';
import { z, ZodError } from 'zod';
import type { Pool } from 'mysql2/promise';
import { rows, run, transaction, duplicate } from './db.js';
import type { Config } from './config.js';
import { hash, secret, encrypt } from './security.js';
import * as v from './validation.js';

class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}
const fail = (status: number, text: string): never => {
  throw new HttpError(status, text);
};
const parseId = (r: FastifyRequest) => v.id.parse((r.params as any).id);
const pageResult = (items: any[], total: number, p: { page: number; pageSize: number }) => ({
  items,
  total: Number(total),
  page: p.page,
  pageSize: p.pageSize,
});
const flags = (a: any) => ({ ...a, enabled: Boolean(a.enabled) });
export async function createApp(pool: Pool, config: Config, logging = true) {
  const app = Fastify({
    bodyLimit: 1024 * 1024,
    trustProxy: '127.0.0.1',
    logger: logging
      ? {
          redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers.set-cookie'],
          serializers: {
            req(r) {
              return { method: r.method, url: r.url?.split('?')[0], remoteAddress: r.ip };
            },
          },
        }
      : false,
  });
  const prefix = config.base.replace(/\/$/, '');
  const adminPath = prefix + '/api/admin';
  const cookieName = 'pulse_session';
  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  await app.register(swagger, {
    openapi: {
      info: {
        title: '热点追踪 API',
        version: '1.0.0',
        description: '调用方自行完成采集、调度和 AI 总结。重复提交不覆盖已有信息。',
      },
      servers: [{ url: config.base }],
      components: { securitySchemes: { callerKey: { type: 'http', scheme: 'bearer' } } },
    },
    transform: ({ schema, url }) => ({
      schema: { ...schema, hide: !url.startsWith(prefix + '/api/v1/') },
      url: url.slice(prefix.length),
    }),
  });
  const requireAdmin = async (r: FastifyRequest) => {
    const token = r.cookies[cookieName];
    if (!token) fail(401, '请先登录');
    const [user] = await rows(
      pool,
      'SELECT a.id,a.username FROM sessions s JOIN admins a ON a.id=s.admin_id WHERE s.token_hash=? AND s.expires_at>UTC_TIMESTAMP(3) AND a.enabled=1',
      [hash(token!)],
    );
    if (!user) fail(401, '登录已失效');
    (r as any).admin = user;
  };
  const csrf = async (r: FastifyRequest) => {
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(r.method) &&
      r.headers['x-requested-with'] !== 'PulseAdmin'
    )
      fail(403, '请求验证失败');
  };
  const requireCaller = async (r: FastifyRequest) => {
    const authorization = r.headers.authorization || '';
    const key = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    if (!key || key.length > 200) fail(401, '调用方 key 无效');
    const [caller] = await rows(pool, 'SELECT id FROM callers WHERE key_hash=? AND enabled=1', [
      hash(key),
    ]);
    if (!caller) fail(401, '调用方 key 无效或已禁用');
    (r as any).callerId = caller.id;
    await run(pool, 'UPDATE callers SET last_used_at=UTC_TIMESTAMP(3) WHERE id=?', [caller.id]);
  };
  app.addHook('onSend', async (r, reply, payload) => {
    reply
      .header('X-Content-Type-Options', 'nosniff')
      .header('Referrer-Policy', 'same-origin')
      .header('X-Frame-Options', 'DENY');
    if (r.url.startsWith(prefix + '/api/')) reply.header('Cache-Control', 'no-store');
    return payload;
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError)
      return reply
        .code(400)
        .send({ message: error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') });
    if (duplicate(error)) return reply.code(409).send({ message: '名称、key 或记录已存在' });
    const status = (error as any).statusCode || 500;
    if (status >= 500)
      app.log.error({ code: (error as any).code || 'INTERNAL_ERROR' }, '请求处理失败');
    return reply
      .code(status)
      .send({ message: status >= 500 ? '服务暂时不可用，请稍后重试' : (error as Error).message });
  });
  app.get(prefix + '/health', { schema: { hide: true } }, async () => {
    await rows(pool, 'SELECT 1');
    return { status: 'ok' };
  });
  await app.register(
    async (admin) => {
      admin.addHook('onRequest', csrf);
      admin.post(
        '/login',
        { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
        async (r, reply) => {
          const input = z
            .object({ username: v.username, password: z.string().min(1).max(200) })
            .parse(r.body);
          const [user] = await rows(pool, 'SELECT * FROM admins WHERE username=?', [
            input.username,
          ]);
          // Fixed valid hash avoids a cheap username-existence timing branch.
          const valid = await bcrypt.compare(
            input.password,
            user?.password_hash || '$2b$12$R9h/cIPz0gi.URNNX3kh2OPST9/PgBkqquzi.Ss7KIUgO2t0jWMUW',
          );
          if (!user?.enabled || !valid) fail(401, '账号或密码错误');
          const token = secret();
          await transaction(pool, async (db) => {
            const [current] = await rows(
              db,
              'SELECT enabled,password_hash FROM admins WHERE id=? FOR UPDATE',
              [user.id],
            );
            if (!current?.enabled || current.password_hash !== user.password_hash)
              fail(401, '账号状态已变化，请重新登录');
            await run(
              db,
              'DELETE FROM sessions WHERE expires_at<=UTC_TIMESTAMP(3) OR token_hash=?',
              [hash(r.cookies[cookieName] || '')],
            );
            await run(
              db,
              'INSERT INTO sessions(token_hash,admin_id,expires_at) VALUES (?,?,DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 12 HOUR))',
              [hash(token), user.id],
            );
          });
          reply.setCookie(cookieName, token, {
            path: config.base,
            httpOnly: true,
            secure: config.secureCookie,
            sameSite: 'strict',
            maxAge: 43200,
          });
          return { id: user.id, username: user.username };
        },
      );
      admin.register(async (protectedApp) => {
        protectedApp.addHook('onRequest', requireAdmin);
        protectedApp.get('/me', async (r) => (r as any).admin);
        protectedApp.post('/logout', async (r, reply) => {
          await run(pool, 'DELETE FROM sessions WHERE token_hash=?', [
            hash(r.cookies[cookieName] || ''),
          ]);
          reply.clearCookie(cookieName, { path: config.base });
          return { ok: true };
        });
        protectedApp.get('/stats', async () => {
          const [stats] = await rows(
            pool,
            `SELECT (SELECT COUNT(*) FROM topics WHERE enabled=1) AS topics,(SELECT COUNT(*) FROM articles) AS articles,(SELECT COUNT(*) FROM subscribers WHERE enabled=1) AS subscribers,(SELECT COUNT(*) FROM notifications WHERE status IN ('pending','retry','sending')) AS pending,(SELECT COUNT(*) FROM notifications WHERE status='failed') AS failed`,
          );
          return stats;
        });
        protectedApp.get('/admins', async (r) => {
          const p = v.paging.parse(r.query);
          const items = await rows(
            pool,
            'SELECT id,username,enabled,created_at FROM admins ORDER BY id DESC LIMIT ? OFFSET ?',
            [p.pageSize, (p.page - 1) * p.pageSize],
          );
          const [count] = await rows(pool, 'SELECT COUNT(*) AS n FROM admins');
          return pageResult(items.map(flags), count.n, p);
        });
        protectedApp.post('/admins', async (r, reply) => {
          const input = v.adminInput.parse(r.body);
          const passwordHash = await bcrypt.hash(input.password, 12);
          const result = await run(
            pool,
            'INSERT INTO admins(username,password_hash) VALUES (?,?)',
            [input.username, passwordHash],
          );
          return reply.code(201).send({ id: result.insertId });
        });
        protectedApp.patch('/admins/:id', async (r) => {
          const id = parseId(r);
          const input = z.object({ enabled: z.boolean() }).parse(r.body);
          await transaction(pool, async (db) => {
            await rows(db, 'SELECT id FROM admin_guard WHERE id=1 FOR UPDATE');
            const [target] = await rows(db, 'SELECT id,enabled FROM admins WHERE id=? FOR UPDATE', [
              id,
            ]);
            if (!target) fail(404, '管理员不存在');
            const [count] = await rows(db, 'SELECT COUNT(*) AS n FROM admins WHERE enabled=1');
            if (!input.enabled && target.enabled && count.n <= 1)
              fail(409, '不能禁用最后一个有效管理员');
            await run(db, 'UPDATE admins SET enabled=? WHERE id=?', [input.enabled, id]);
            if (!input.enabled) await run(db, 'DELETE FROM sessions WHERE admin_id=?', [id]);
          });
          return { ok: true };
        });
        protectedApp.post('/admins/:id/password', async (r) => {
          const id = parseId(r);
          const input = z.object({ password: v.password }).parse(r.body);
          const h = await bcrypt.hash(input.password, 12);
          await transaction(pool, async (db) => {
            const result = await run(db, 'UPDATE admins SET password_hash=? WHERE id=?', [h, id]);
            if (!result.affectedRows) fail(404, '管理员不存在');
            await run(db, 'DELETE FROM sessions WHERE admin_id=?', [id]);
          });
          return { ok: true };
        });
        protectedApp.get('/topics', async (r) => {
          const p = v.paging.parse(r.query);
          const where = "WHERE name LIKE ? ESCAPE '!' OR note LIKE ? ESCAPE '!'";
          const params = [v.like(p.q), v.like(p.q)];
          const items = await rows(
            pool,
            `SELECT * FROM topics ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
            [...params, p.pageSize, (p.page - 1) * p.pageSize],
          );
          const [count] = await rows(pool, `SELECT COUNT(*) AS n FROM topics ${where}`, params);
          return pageResult(items.map(flags), count.n, p);
        });
        protectedApp.post('/topics', async (r, reply) => {
          const input = v.topicInput.parse(r.body);
          const result = await run(pool, 'INSERT INTO topics(name,note,enabled) VALUES (?,?,?)', [
            input.name,
            input.note,
            input.enabled,
          ]);
          return reply.code(201).send({ id: result.insertId });
        });
        protectedApp.put('/topics/:id', async (r) => {
          const input = v.topicInput.parse(r.body);
          const result = await run(
            pool,
            'UPDATE topics SET name=?,note=?,enabled=?,updated_at=UTC_TIMESTAMP(3) WHERE id=?',
            [input.name, input.note, input.enabled, parseId(r)],
          );
          if (!result.affectedRows) fail(404, '热点不存在');
          return { ok: true };
        });
        protectedApp.get('/callers', async (r) => {
          const p = v.paging.parse(r.query);
          const items = await rows(
            pool,
            'SELECT id,name,key_prefix,enabled,last_used_at,created_at FROM callers ORDER BY id DESC LIMIT ? OFFSET ?',
            [p.pageSize, (p.page - 1) * p.pageSize],
          );
          const [count] = await rows(pool, 'SELECT COUNT(*) AS n FROM callers');
          return pageResult(items.map(flags), count.n, p);
        });
        protectedApp.post('/callers', async (r, reply) => {
          const input = v.callerInput.parse(r.body);
          const key = 'pn_' + secret();
          const result = await run(
            pool,
            'INSERT INTO callers(name,key_hash,key_prefix) VALUES (?,?,?)',
            [input.name, hash(key), key.slice(0, 10)],
          );
          return reply.code(201).send({ id: result.insertId, key });
        });
        protectedApp.patch('/callers/:id', async (r) => {
          const input = z.object({ enabled: z.boolean() }).parse(r.body);
          const result = await run(pool, 'UPDATE callers SET enabled=? WHERE id=?', [
            input.enabled,
            parseId(r),
          ]);
          if (!result.affectedRows) fail(404, '调用方不存在');
          return { ok: true };
        });
        protectedApp.post('/callers/:id/reset-key', async (r) => {
          const key = 'pn_' + secret();
          const result = await run(pool, 'UPDATE callers SET key_hash=?,key_prefix=? WHERE id=?', [
            hash(key),
            key.slice(0, 10),
            parseId(r),
          ]);
          if (!result.affectedRows) fail(404, '调用方不存在');
          return { key };
        });
        protectedApp.get('/articles', async (r) => {
          const p = v.paging
            .extend({ topicId: v.id.optional(), from: v.date.optional(), to: v.date.optional() })
            .parse(r.query);
          if (p.from && p.to && p.from > p.to) fail(400, '开始日期不能晚于结束日期');
          const clauses = [
            "(a.title LIKE ? ESCAPE '!' OR a.ai_summary LIKE ? ESCAPE '!' OR a.content LIKE ? ESCAPE '!')",
          ];
          const params: any[] = [v.like(p.q), v.like(p.q), v.like(p.q)];
          if (p.topicId) {
            clauses.push('a.topic_id=?');
            params.push(p.topicId);
          }
          if (p.from) {
            clauses.push('a.article_date>=?');
            params.push(p.from);
          }
          if (p.to) {
            clauses.push('a.article_date<=?');
            params.push(p.to);
          }
          const where = 'WHERE ' + clauses.join(' AND ');
          const items = await rows(
            pool,
            `SELECT a.id,a.topic_id,a.article_date,a.title,LEFT(a.ai_summary,300) AS ai_summary,a.url,a.created_at,t.name AS topic_name,c.name AS caller_name FROM articles a JOIN topics t ON t.id=a.topic_id JOIN callers c ON c.id=a.caller_id ${where} ORDER BY a.article_date DESC,a.id DESC LIMIT ? OFFSET ?`,
            [...params, p.pageSize, (p.page - 1) * p.pageSize],
          );
          const [count] = await rows(pool, `SELECT COUNT(*) AS n FROM articles a ${where}`, params);
          return pageResult(items, count.n, p);
        });
        protectedApp.get('/articles/:id', async (r) => {
          const [a] = await rows(
            pool,
            'SELECT a.*,t.name AS topic_name,c.name AS caller_name FROM articles a JOIN topics t ON t.id=a.topic_id JOIN callers c ON c.id=a.caller_id WHERE a.id=?',
            [parseId(r)],
          );
          if (!a) fail(404, '信息不存在');
          return a;
        });
        protectedApp.get('/subscribers', async (r) => {
          const p = v.paging.parse(r.query);
          const items = await rows(
            pool,
            'SELECT id,name,key_suffix,all_topics,enabled,created_at FROM subscribers ORDER BY id DESC LIMIT ? OFFSET ?',
            [p.pageSize, (p.page - 1) * p.pageSize],
          );
          for (const item of items) {
            item.topicIds = (
              await rows(pool, 'SELECT topic_id FROM subscriber_topics WHERE subscriber_id=?', [
                item.id,
              ])
            ).map((a) => a.topic_id);
            item.allTopics = Boolean(item.all_topics);
            delete item.all_topics;
          }
          const [count] = await rows(pool, 'SELECT COUNT(*) AS n FROM subscribers');
          return pageResult(items.map(flags), count.n, p);
        });
        const saveSubscriber = async (r: FastifyRequest, existing: boolean) => {
          const input = v.subscriberInput.parse(r.body);
          if (!existing && !input.key) fail(400, '请填写机器人 key');
          return transaction(pool, async (db) => {
            let id = existing ? parseId(r) : 0;
            if (existing) {
              const [old] = await rows(db, 'SELECT id FROM subscribers WHERE id=? FOR UPDATE', [
                id,
              ]);
              if (!old) fail(404, '订阅方不存在');
            }
            const topicIds = [...new Set(input.topicIds)];
            if (!input.allTopics)
              for (const topicId of topicIds) {
                const [topic] = await rows(db, 'SELECT id FROM topics WHERE id=?', [topicId]);
                if (!topic) fail(400, '选择的热点不存在');
              }
            if (existing) {
              await run(db, 'UPDATE subscribers SET name=?,all_topics=?,enabled=? WHERE id=?', [
                input.name,
                input.allTopics,
                input.enabled,
                id,
              ]);
              if (input.key)
                await run(
                  db,
                  'UPDATE subscribers SET key_cipher=?,key_hash=?,key_suffix=? WHERE id=?',
                  [
                    encrypt(input.key, config.encryptionKey),
                    hash(input.key),
                    input.key.slice(-4),
                    id,
                  ],
                );
            } else {
              const key = input.key!;
              const result = await run(
                db,
                'INSERT INTO subscribers(name,key_cipher,key_hash,key_suffix,all_topics,enabled) VALUES (?,?,?,?,?,?)',
                [
                  input.name,
                  encrypt(key, config.encryptionKey),
                  hash(key),
                  key.slice(-4),
                  input.allTopics,
                  input.enabled,
                ],
              );
              id = result.insertId;
            }
            await run(db, 'DELETE FROM subscriber_topics WHERE subscriber_id=?', [id]);
            if (!input.allTopics)
              for (const topicId of topicIds)
                await run(
                  db,
                  'INSERT INTO subscriber_topics(subscriber_id,topic_id) VALUES (?,?)',
                  [id, topicId],
                );
            if (!input.enabled)
              await run(
                db,
                "UPDATE notifications SET status='cancelled',last_error='订阅方已禁用' WHERE subscriber_id=? AND status IN ('pending','retry')",
                [id],
              );
            return { id };
          });
        };
        protectedApp.post('/subscribers', async (r, reply) =>
          reply.code(201).send(await saveSubscriber(r, false)),
        );
        protectedApp.put('/subscribers/:id', async (r) => saveSubscriber(r, true));
        protectedApp.post(
          '/subscribers/:id/test',
          { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
          async (r, reply) => {
            const id = parseId(r);
            const result = await transaction(pool, async (db) => {
              const [s] = await rows(db, 'SELECT enabled FROM subscribers WHERE id=? FOR UPDATE', [
                id,
              ]);
              if (!s) fail(404, '订阅方不存在');
              if (!s.enabled) fail(409, '请先启用订阅方');
              return run(db, "INSERT INTO notifications(subscriber_id,kind) VALUES (?,'test')", [
                id,
              ]);
            });
            return reply.code(202).send({ id: result.insertId, status: 'pending' });
          },
        );
        protectedApp.get('/notifications', async (r) => {
          const p = v.paging
            .extend({
              subscriberId: v.id.optional(),
              status: z
                .enum(['pending', 'sending', 'retry', 'sent', 'failed', 'cancelled'])
                .optional(),
            })
            .parse(r.query);
          const where: string[] = [];
          const params: any[] = [];
          if (p.subscriberId) {
            where.push('n.subscriber_id=?');
            params.push(p.subscriberId);
          }
          if (p.status) {
            where.push('n.status=?');
            params.push(p.status);
          }
          const clause = where.length ? 'WHERE ' + where.join(' AND ') : '';
          const items = await rows(
            pool,
            `SELECT n.*,s.name AS subscriber_name,a.title FROM notifications n JOIN subscribers s ON s.id=n.subscriber_id LEFT JOIN articles a ON a.id=n.article_id ${clause} ORDER BY n.id DESC LIMIT ? OFFSET ?`,
            [...params, p.pageSize, (p.page - 1) * p.pageSize],
          );
          for (const i of items) {
            delete i.lease_token;
          }
          const [count] = await rows(
            pool,
            `SELECT COUNT(*) AS n FROM notifications n ${clause}`,
            params,
          );
          return pageResult(items, count.n, p);
        });
        protectedApp.get('/notifications/:id/attempts', async (r) =>
          rows(
            pool,
            'SELECT id,generation,attempt,outcome,error,created_at,finished_at FROM notification_attempts WHERE notification_id=? ORDER BY id DESC LIMIT 100',
            [parseId(r)],
          ),
        );
        protectedApp.post('/notifications/:id/retry', async (r) => {
          await transaction(pool, async (db) => {
            const [n] = await rows(
              db,
              'SELECT n.*,s.enabled FROM notifications n JOIN subscribers s ON s.id=n.subscriber_id WHERE n.id=? FOR UPDATE',
              [parseId(r)],
            );
            if (!n) fail(404, '通知不存在');
            if (n.status !== 'failed' || !n.enabled) fail(409, '仅可重试已启用订阅方的失败通知');
            await run(
              db,
              "UPDATE notifications SET status='pending',attempts=0,generation=generation+1,last_error=NULL,next_attempt_at=UTC_TIMESTAMP(3),lease_until=NULL,lease_token=NULL WHERE id=?",
              [n.id],
            );
          });
          return { ok: true };
        });
      });
    },
    { prefix: adminPath },
  );
  await app.register(swaggerUI, {
    routePrefix: prefix + '/api/docs',
    uiHooks: { onRequest: requireAdmin },
    uiConfig: { persistAuthorization: false },
  });
  const apiAuth = {
    onRequest: requireCaller,
    config: {
      rateLimit: {
        max: 120,
        timeWindow: '1 minute',
        keyGenerator: (r: FastifyRequest) => hash(r.headers.authorization || r.ip),
      },
    },
  };
  app.get(
    prefix + '/api/v1/topics',
    {
      ...apiAuth,
      schema: {
        security: [{ callerKey: [] }],
        summary: '分页查询启用的追踪热点',
        querystring: {
          type: 'object',
          properties: {
            page: { type: 'integer', minimum: 1, maximum: 100000, default: 1 },
            pageSize: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
          },
        },
      },
    },
    async (r) => {
      const p = v.paging.parse(r.query);
      const items = await rows(
        pool,
        'SELECT id,name,note,created_at AS createdAt,updated_at AS updatedAt FROM topics WHERE enabled=1 ORDER BY id LIMIT ? OFFSET ?',
        [p.pageSize, (p.page - 1) * p.pageSize],
      );
      const [count] = await rows(pool, 'SELECT COUNT(*) AS n FROM topics WHERE enabled=1');
      return pageResult(items, count.n, p);
    },
  );
  app.post(
    prefix + '/api/v1/articles',
    {
      ...apiAuth,
      schema: {
        security: [{ callerKey: [] }],
        summary: '提交信息；按热点和规范化链接去重',
        body: {
          type: 'object',
          required: ['topicId', 'date', 'title', 'content', 'url'],
          additionalProperties: false,
          properties: {
            topicId: { type: 'integer', minimum: 1 },
            date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
            title: { type: 'string', minLength: 1, maxLength: 500 },
            aiSummary: { type: 'string', maxLength: 12000, default: '' },
            content: { type: 'string', minLength: 1, maxLength: 200000 },
            url: { type: 'string', maxLength: 2048 },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: { id: { type: 'integer' }, duplicate: { type: 'boolean' } },
          },
          201: {
            type: 'object',
            properties: { id: { type: 'integer' }, duplicate: { type: 'boolean' } },
          },
        },
      },
    },
    async (r, reply) => {
      const input = v.articleInput.parse(r.body);
      const urlHash = hash(input.url);
      const result = await transaction(pool, async (db) => {
        // Lock topic first: serialize same-topic ingestion and coordinate with stop/edit.
        const [topic] = await rows(db, 'SELECT id,enabled FROM topics WHERE id=? FOR UPDATE', [
          input.topicId,
        ]);
        if (!topic) fail(404, '热点不存在');
        const [existing] = await rows(
          db,
          'SELECT id FROM articles WHERE topic_id=? AND url_hash=?',
          [input.topicId, urlHash],
        );
        if (existing) return { id: existing.id, duplicate: true };
        if (!topic.enabled) fail(409, '热点已停用');
        const inserted = await run(
          db,
          'INSERT INTO articles(topic_id,caller_id,article_date,title,ai_summary,content,url,url_hash) VALUES (?,?,?,?,?,?,?,?)',
          [
            input.topicId,
            (r as any).callerId,
            input.date,
            input.title,
            input.aiSummary,
            input.content,
            input.url,
            urlHash,
          ],
        );
        await run(
          db,
          `INSERT INTO notifications(subscriber_id,article_id) SELECT s.id,? FROM subscribers s WHERE s.enabled=1 AND (s.all_topics=1 OR EXISTS(SELECT 1 FROM subscriber_topics st WHERE st.subscriber_id=s.id AND st.topic_id=?))`,
          [inserted.insertId, input.topicId],
        );
        return { id: inserted.insertId, duplicate: false };
      });
      return reply.code(result.duplicate ? 200 : 201).send(result);
    },
  );
  const clientDir = resolve('dist/client');
  if (existsSync(clientDir)) {
    await app.register(staticFiles, { root: clientDir, prefix: config.base, wildcard: false });
    app.setNotFoundHandler((r, reply) => {
      const path = r.url.split('?')[0];
      if (
        r.method === 'GET' &&
        path.startsWith(config.base) &&
        !path.startsWith(prefix + '/api/') &&
        !path.includes('.')
      )
        return reply.sendFile('index.html');
      return reply.code(404).send({ message: '页面或接口不存在' });
    });
  }
  return app;
}
