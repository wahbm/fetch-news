import 'dotenv/config';
import mysql, {
  type Pool,
  type PoolConnection,
  type ResultSetHeader,
  type RowDataPacket,
} from 'mysql2/promise';
export type DB = Pool | PoolConnection;
export function createDB() {
  return mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'fetch_news',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'fetch_news',
    connectionLimit: 8,
    charset: 'utf8mb4',
    timezone: 'Z',
    dateStrings: true,
    decimalNumbers: true,
    supportBigNumbers: true,
    bigNumberStrings: false,
    multipleStatements: false,
  });
}
export async function rows<T = any>(db: DB, sql: string, values: any[] = []): Promise<T[]> {
  const [r] = await db.execute<RowDataPacket[]>(sql, values);
  return r as T[];
}
export async function run(db: DB, sql: string, values: any[] = []) {
  const [r] = await db.execute<ResultSetHeader>(sql, values);
  return r;
}
export async function transaction<T>(
  pool: Pool,
  fn: (db: PoolConnection) => Promise<T>,
): Promise<T> {
  const db = await pool.getConnection();
  try {
    await db.beginTransaction();
    const result = await fn(db);
    await db.commit();
    return result;
  } catch (e) {
    await db.rollback();
    throw e;
  } finally {
    db.release();
  }
}
export function duplicate(e: unknown) {
  return (e as { code?: string })?.code === 'ER_DUP_ENTRY';
}
