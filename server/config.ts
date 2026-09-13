import 'dotenv/config';
export interface Config {
  host: string;
  port: number;
  base: string;
  production: boolean;
  secureCookie: boolean;
  encryptionKey: Buffer;
  worker: boolean;
}
export function readConfig(): Config {
  const base = process.env.APP_BASE_PATH || '/';
  if (!/^\/(?:[a-zA-Z0-9_-]+\/)*$/.test(base))
    throw new Error('APP_BASE_PATH must start and end with / and contain safe path segments');
  const encryptionKey = Buffer.from(process.env.ENCRYPTION_KEY || '', 'base64');
  if (encryptionKey.length !== 32)
    throw new Error('ENCRYPTION_KEY must be a base64-encoded 32-byte key');
  const production = process.env.NODE_ENV === 'production';
  const secureCookie = process.env.COOKIE_SECURE !== 'false';
  if (production && !secureCookie)
    throw new Error('Production requires COOKIE_SECURE=true and HTTPS');
  return {
    host: process.env.HOST || '127.0.0.1',
    port: Number(process.env.PORT || 3000),
    base,
    production,
    secureCookie,
    encryptionKey,
    worker: process.env.WORKER_ENABLED !== 'false',
  };
}
