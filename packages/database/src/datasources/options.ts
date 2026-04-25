import type { DataSourceOptions } from 'typeorm';
import { join, resolve } from 'path';

export type AppDatabaseDriver = 'sqlite' | 'postgres';

export interface AppDataSourceEnv {
  type: AppDatabaseDriver;
  url: string;
  whoPath: string;
}

export function readAppDataSourceEnv(env: NodeJS.ProcessEnv = process.env): AppDataSourceEnv {
  const type = (env.DATABASE_TYPE ?? 'sqlite') as AppDatabaseDriver;
  if (type !== 'sqlite' && type !== 'postgres') {
    throw new Error(`Unsupported DATABASE_TYPE: ${type}`);
  }
  const url = env.DATABASE_URL ?? './data/data.db';
  const whoPath = env.WHO_DATABASE_PATH ?? './data/who.db';
  return { type, url, whoPath };
}

const ENTITIES_GLOB = join(__dirname, '..', 'entities', '*.entity.{ts,js}');
const MIGRATIONS_GLOB = join(__dirname, '..', 'migrations', '*.{ts,js}');

export function buildAppDataSourceOptions(env = readAppDataSourceEnv()): DataSourceOptions {
  if (env.type === 'sqlite') {
    return {
      type: 'better-sqlite3',
      database: resolve(env.url),
      entities: [ENTITIES_GLOB],
      migrations: [MIGRATIONS_GLOB],
      migrationsRun: false,
      synchronize: false,
      logging: false,
    };
  }
  return {
    type: 'postgres',
    url: env.url,
    entities: [ENTITIES_GLOB],
    migrations: [MIGRATIONS_GLOB],
    migrationsRun: false,
    synchronize: false,
    logging: false,
  };
}

export function buildWhoDataSourceOptions(env = readAppDataSourceEnv()): DataSourceOptions {
  return {
    name: 'who',
    type: 'better-sqlite3',
    database: resolve(env.whoPath),
    entities: [join(__dirname, '..', 'entities', 'who-lms-standard.entity.{ts,js}')],
    migrations: [],
    migrationsRun: false,
    synchronize: false,
    logging: false,
  };
}
