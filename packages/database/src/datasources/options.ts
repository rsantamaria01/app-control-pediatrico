import type { DataSourceOptions } from 'typeorm';
import { join } from 'path';

export interface AppDataSourceEnv {
  url: string;
}

export function readAppDataSourceEnv(env: NodeJS.ProcessEnv = process.env): AppDataSourceEnv {
  const url = env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL is required (postgres:// connection string). The application is Postgres-only.',
    );
  }
  if (!url.startsWith('postgres://') && !url.startsWith('postgresql://')) {
    throw new Error(
      `DATABASE_URL must be a postgres:// connection string, got: ${url}`,
    );
  }
  return { url };
}

const ENTITIES_GLOB = join(__dirname, '..', 'entities', '*.entity.{ts,js}');
const MIGRATIONS_GLOB = join(__dirname, '..', 'migrations', '*.{ts,js}');

export function buildAppDataSourceOptions(env = readAppDataSourceEnv()): DataSourceOptions {
  return {
    type: 'postgres',
    url: env.url,
    entities: [ENTITIES_GLOB],
    migrations: [MIGRATIONS_GLOB],
    // Migrations run automatically when the API connects so a fresh
    // Postgres container becomes usable without an out-of-band step.
    migrationsRun: true,
    synchronize: false,
    logging: false,
  };
}
