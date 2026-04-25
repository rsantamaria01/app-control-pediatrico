import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { buildAppDataSourceOptions } from './options';

/**
 * Lazily constructed for the TypeORM CLI (`pnpm typeorm …`). The
 * runtime app uses `buildAppDataSourceOptions()` directly via
 * `TypeOrmModule.forRootAsync`, so we don't want a top-level
 * `new DataSource(...)` to read DATABASE_URL at import time — that
 * would break unit tests that just want to import an entity.
 */
let cached: DataSource | null = null;
function getAppDataSource(): DataSource {
  if (!cached) {
    cached = new DataSource(buildAppDataSourceOptions());
  }
  return cached;
}

// The TypeORM CLI looks for a default export named `AppDataSource`.
// Re-export via a Proxy so accessing properties (e.g. `.options` or
// `.initialize()`) triggers construction without eager evaluation.
export const AppDataSource: DataSource = new Proxy({} as DataSource, {
  get(_target, prop) {
    return Reflect.get(getAppDataSource(), prop);
  },
}) as DataSource;
