import { createDB } from './db.js';
import { readConfig } from './config.js';
import { createApp } from './app.js';
import { NotificationWorker } from './worker.js';
const config = readConfig();
const pool = createDB();
const app = await createApp(pool, config);
const worker = new NotificationWorker(pool, config.encryptionKey, undefined, () =>
  app.log.error('通知队列暂时不可用，将自动重试'),
);
try {
  await pool.query('SELECT id FROM admin_guard LIMIT 1');
  await app.listen({ host: config.host, port: config.port });
  if (config.worker) worker.start();
} catch {
  app.log.error('启动失败，请检查配置、数据库迁移和端口');
  await app.close();
  await pool.end();
  process.exitCode = 1;
}
let closing = false;
const stop = async () => {
  if (closing) return;
  closing = true;
  await worker.stop();
  await app.close();
  await pool.end();
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
