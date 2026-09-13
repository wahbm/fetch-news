import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { createDB, rows, run } from '../server/db.js';
if (!process.env.DB_NAME?.endsWith('_test'))
  throw Error('Runtime smoke requires an isolated *_test database.');
const temp = await mkdtemp(join(tmpdir(), 'pulse-runtime-'));
const password = randomBytes(20).toString('base64url');
const username = 'runtime-' + Date.now();
const passwordFile = join(temp, 'password');
await writeFile(passwordFile, password, { mode: 0o600 });
const socket = createServer();
socket.listen(0, '127.0.0.1');
await once(socket, 'listening');
const port = (socket.address() as { port: number }).port;
await new Promise<void>((resolve, reject) => socket.close((e) => (e ? reject(e) : resolve())));
const env = {
  ...process.env,
  NODE_ENV: 'production',
  COOKIE_SECURE: 'true',
  ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  WORKER_ENABLED: 'false',
  HOST: '127.0.0.1',
  PORT: String(port),
  ADMIN_PASSWORD_FILE: passwordFile,
};
const pool = createDB();
let child: ReturnType<typeof spawn> | undefined;
try {
  for (const args of [['migrate'], ['admin', username]]) {
    const result = spawnSync(process.execPath, ['dist/server/cli.js', ...args], {
      env,
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
  }
  const [admin] = await rows(pool, 'SELECT password_hash FROM admins WHERE username=?', [username]);
  assert.ok(await bcrypt.compare(password, admin.password_hash));
  child = spawn(process.execPath, ['dist/server/index.js'], { env, stdio: 'ignore' });
  const base = process.env.APP_BASE_PATH || '/';
  let ready = false;
  for (let i = 0; i < 30; i++) {
    assert.equal(child.exitCode, null, 'Compiled server exited early');
    try {
      const result = await fetch(`http://127.0.0.1:${port}${base}health`);
      ready = result.ok && ((await result.json()) as any).status === 'ok';
    } catch {
      /* startup */
    }
    if (ready) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(ready, 'Compiled server did not become healthy');
  const deepLink = await fetch(`http://127.0.0.1:${port}${base}articles`);
  assert.equal(deepLink.status, 200);
  assert.ok((await deepLink.text()).includes('<div id="root">'));
  console.log(
    'Compiled CLI migration/admin initialization, production startup, DB health and SPA deep link passed.',
  );
} finally {
  if (child && child.exitCode === null) {
    child.kill('SIGTERM');
    await once(child, 'exit');
  }
  await run(pool, 'DELETE FROM admins WHERE username=?', [username]);
  await pool.end();
  await rm(temp, { recursive: true, force: true });
}
