import { randomBytes } from 'node:crypto';
import type { Pool } from 'mysql2/promise';
import { rows, run, transaction } from './db.js';
import {
  decrypt,
  hash,
  notificationNews,
  testNotificationText,
  type WecomMessage,
} from './security.js';
export type SendResult = { ok: boolean; permanent?: boolean; error?: string };
export type Sender = (key: string, message: WecomMessage) => Promise<SendResult>;
// https://developer.work.weixin.qq.com/document/path/90313
// Invalid/removed/disabled webhook or invalid payload: requires operator action.
const permanentCodes = new Set([
  93000, 93001, 93004, 93006, 93008, 93017, 93019, 40058, 40063, 44004, 40008, 45002,
]);
export const sendWecom: Sender = async (key, message) => {
  try {
    const response = await fetch(
      'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=' + encodeURIComponent(key),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(message),
        signal: AbortSignal.timeout(10000),
        redirect: 'error',
      },
    );
    if (!response.ok)
      return {
        ok: false,
        permanent:
          response.status >= 400 && response.status < 500 && ![408, 429].includes(response.status),
        error: `HTTP ${response.status}`,
      };
    const body = (await response.json()) as { errcode?: number };
    if (body.errcode === 0) return { ok: true };
    return {
      ok: false,
      permanent: typeof body.errcode === 'number' && permanentCodes.has(body.errcode),
      error:
        typeof body.errcode === 'number'
          ? `企业微信错误码 ${body.errcode}`
          : '企业微信响应格式无效',
    };
  } catch {
    return { ok: false, error: '网络失败或请求超时，接收状态未知' };
  }
};
export const retryMinutes = [1, 5, 15, 60];
export class NotificationWorker {
  private stopped = true;
  private timer?: NodeJS.Timeout;
  private active?: Promise<void>;
  constructor(
    private pool: Pool,
    private encryptionKey: Buffer,
    private sender: Sender = sendWecom,
    private onError: (e: unknown) => void = () => {},
  ) {}
  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.schedule();
  }
  private schedule() {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.active = this.tick()
        .catch(this.onError)
        .finally(() => {
          this.active = undefined;
          this.schedule();
        });
    }, 500);
  }
  async stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.active;
  }
  async tick() {
    // A dedicated connection holds the advisory lock through HTTP delivery. This
    // deliberately allows one dispatcher across all app instances on this DB.
    const lock = await this.pool.getConnection();
    const lockName = 'pulse-worker-' + hash(process.env.DB_NAME || 'fetch_news').slice(0, 30);
    let acquired = false;
    try {
      const [lockResult] = await rows(lock, 'SELECT GET_LOCK(?,0) AS acquired', [lockName]);
      if (!lockResult.acquired) return;
      acquired = true;
      await transaction(this.pool, async (db) => {
        await run(
          db,
          `UPDATE notification_attempts a JOIN notifications n ON n.id=a.notification_id SET a.outcome='unknown',a.error='进程中断，接收状态未知',a.finished_at=UTC_TIMESTAMP(3) WHERE n.status='sending' AND n.lease_until<UTC_TIMESTAMP(3) AND a.outcome='sending'`,
        );
        await run(
          db,
          `UPDATE notifications SET status=IF(attempts>=5,'failed','retry'),last_error='进程中断，接收状态未知',next_attempt_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL CASE attempts WHEN 1 THEN 1 WHEN 2 THEN 5 WHEN 3 THEN 15 ELSE 60 END MINUTE),lease_until=NULL,lease_token=NULL WHERE status='sending' AND lease_until<UTC_TIMESTAMP(3)`,
        );
        await run(
          db,
          `UPDATE notifications n JOIN subscribers s ON s.id=n.subscriber_id SET n.status='cancelled',n.last_error='订阅方已禁用' WHERE s.enabled=0 AND n.status IN ('pending','retry')`,
        );
      });
      const task = await transaction(this.pool, async (db) => {
        const [n] = await rows(
          db,
          `SELECT n.*,s.key_cipher FROM notifications n JOIN subscribers s ON s.id=n.subscriber_id WHERE n.status IN ('pending','retry') AND n.next_attempt_at<=UTC_TIMESTAMP(3) AND s.enabled=1 AND (s.next_send_at IS NULL OR s.next_send_at<=UTC_TIMESTAMP(3)) ORDER BY n.next_attempt_at,n.id LIMIT 1 FOR UPDATE`,
        );
        if (!n) return null;
        const token = randomBytes(16).toString('hex');
        await run(
          db,
          "UPDATE notifications SET status='sending',attempts=attempts+1,lease_until=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 60 SECOND),lease_token=? WHERE id=?",
          [token, n.id],
        );
        await run(
          db,
          'UPDATE subscribers SET next_send_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 3100000 MICROSECOND) WHERE id=?',
          [n.subscriber_id],
        );
        const a = await run(
          db,
          "INSERT INTO notification_attempts(notification_id,generation,attempt,outcome) VALUES (?,?,?,'sending')",
          [n.id, n.generation, n.attempts + 1],
        );
        return { ...n, attempts: n.attempts + 1, token, attemptId: a.insertId };
      });
      if (!task) return;
      // Database read failures must leave the lease recoverable, not mark a
      // valid notification as permanently failed.
      const [article] = task.article_id
        ? await rows(
            this.pool,
            'SELECT a.title,a.article_date AS date,a.ai_summary AS summary,a.url,a.heat_score AS heatScore,t.name AS topic FROM articles a JOIN topics t ON t.id=a.topic_id WHERE a.id=?',
            [task.article_id],
          )
        : [undefined];
      let result: SendResult | undefined;
      let key = '';
      let message: WecomMessage | undefined;
      try {
        key = decrypt(task.key_cipher, this.encryptionKey);
        message = task.article_id ? notificationNews(article) : testNotificationText();
      } catch {
        result = { ok: false, permanent: true, error: '通知内容或凭据无法读取' };
      }
      if (message) {
        try {
          result = await this.sender(key, message);
        } catch {
          result = { ok: false, error: '网络失败或请求超时，接收状态未知' };
        }
      }
      result ??= { ok: false, permanent: true, error: '通知内容无效' };
      await transaction(this.pool, async (db) => {
        const status = result.ok
          ? 'sent'
          : result.permanent || task.attempts >= 5
            ? 'failed'
            : 'retry';
        const wait = retryMinutes[Math.min(task.attempts - 1, 3)];
        // Sender errors are controlled strings; never store remote bodies or webhook URLs.
        const error = result.ok ? null : (result.error || '通知发送失败').slice(0, 500);
        await run(
          db,
          'UPDATE notification_attempts SET outcome=?,error=?,finished_at=UTC_TIMESTAMP(3) WHERE id=?',
          [result.ok ? 'sent' : 'failed', error, task.attemptId],
        );
        await run(
          db,
          `UPDATE notifications SET status=?,last_error=?,sent_at=IF(?='sent',UTC_TIMESTAMP(3),NULL),next_attempt_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL ? MINUTE),lease_until=NULL,lease_token=NULL WHERE id=? AND lease_token=?`,
          [status, error, status, wait, task.id, task.token],
        );
      });
    } finally {
      try {
        if (acquired) await rows(lock, 'SELECT RELEASE_LOCK(?)', [lockName]);
      } finally {
        lock.release();
      }
    }
  }
}
