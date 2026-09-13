import { readFile } from 'node:fs/promises';
import bcrypt from 'bcryptjs';
import { createDB, run } from './db.js';
import { migrate } from './migrate.js';
import { adminInput } from './validation.js';
const pool = createDB();
try {
  const command = process.argv[2];
  if (command === 'migrate') {
    await migrate(pool);
    console.log('数据库迁移完成');
  } else if (command === 'admin') {
    const username = process.argv[3];
    const passwordFile = process.env.ADMIN_PASSWORD_FILE;
    if (!passwordFile)
      throw Error(
        'Set ADMIN_PASSWORD_FILE to a protected file containing the initial password; do not put passwords in command arguments.',
      );
    const input = adminInput.parse({
      username,
      password: (await readFile(passwordFile, 'utf8')).replace(/\r?\n$/, ''),
    });
    await run(pool, 'INSERT INTO admins(username,password_hash) VALUES (?,?)', [
      input.username,
      await bcrypt.hash(input.password, 12),
    ]);
    console.log('管理员已创建');
  } else throw Error('Usage: cli migrate | cli admin <username> (with ADMIN_PASSWORD_FILE)');
} catch (e) {
  console.error((e as any).code === 'ER_DUP_ENTRY' ? '管理员已存在' : (e as Error).message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
