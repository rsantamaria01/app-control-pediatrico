import { Client } from 'pg';

/**
 * Run once before any e2e test. Drops + recreates the test database
 * (default `app_test`) so each `pnpm test:e2e` run starts from an
 * empty schema. The Nest app under test then auto-runs migrations on
 * boot via `migrationsRun: true`.
 *
 * Connection string priority:
 *   1. TEST_DATABASE_URL (explicit override)
 *   2. derived from DATABASE_URL by replacing the database name with
 *      "app_test" so a single `.env` powers both the app and tests.
 */
async function ensureTestDatabase(): Promise<void> {
  const explicit = process.env.TEST_DATABASE_URL;
  const base = process.env.DATABASE_URL ?? 'postgres://app:app@localhost:5432/app';
  const testUrl = explicit ?? deriveTestUrl(base);
  const adminUrl = withDatabase(testUrl, 'postgres');
  const dbName = new URL(testUrl).pathname.replace(/^\//, '');

  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    // Terminate any lingering connections so DROP succeeds.
    await admin.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [dbName],
    );
    await admin.query(`DROP DATABASE IF EXISTS "${dbName}"`);
    await admin.query(`CREATE DATABASE "${dbName}"`);
  } finally {
    await admin.end();
  }
  // Tell the test process which DB to point at.
  process.env.DATABASE_URL = testUrl;
}

function deriveTestUrl(base: string): string {
  return withDatabase(base, 'app_test');
}

function withDatabase(url: string, db: string): string {
  const u = new URL(url);
  u.pathname = `/${db}`;
  return u.toString();
}

export default async function globalSetup(): Promise<void> {
  await ensureTestDatabase();
}
