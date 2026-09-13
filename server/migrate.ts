import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Pool } from 'mysql2/promise';
import { rows, run } from './db.js';
import { hash } from './security.js';
export async function migrate(pool: Pool) {
  const db = await pool.getConnection();
  try {
    const [lock] = await rows(db, "SELECT GET_LOCK('pulse-schema-migrate',30) AS acquired");
    if (!lock.acquired) throw Error('Migration lock unavailable');
    await run(
      db,
      'CREATE TABLE IF NOT EXISTS schema_migrations (name VARCHAR(200) PRIMARY KEY, checksum CHAR(64) NOT NULL, applied_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3)) CHARACTER SET utf8mb4',
    );
    for (const name of (await readdir(resolve('migrations')))
      .filter((n) => /^\d+.*\.sql$/.test(n))
      .sort()) {
      const sql = await readFile(resolve('migrations', name), 'utf8');
      const [old] = await rows(db, 'SELECT checksum FROM schema_migrations WHERE name=?', [name]);
      if (old) {
        if (old.checksum !== hash(sql)) throw Error(`Migration changed: ${name}`);
        continue;
      }
      for (const statement of sql
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean))
        await run(db, statement);
      await run(db, 'INSERT INTO schema_migrations(name,checksum) VALUES (?,?)', [name, hash(sql)]);
    }
  } finally {
    try {
      await rows(db, "SELECT RELEASE_LOCK('pulse-schema-migrate')");
    } finally {
      db.release();
    }
  }
}
