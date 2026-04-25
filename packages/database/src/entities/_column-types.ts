/**
 * Cross-driver column type aliases. TypeORM rejects 'timestamp' on
 * better-sqlite3 and 'datetime' on Postgres, so we resolve the right
 * vendor type once at module load using DATABASE_TYPE.
 */
const isPostgres = (process.env.DATABASE_TYPE ?? 'sqlite').toLowerCase() === 'postgres';

export const TS_TYPE = isPostgres ? 'timestamp' : 'datetime';
export const NUMERIC_TYPE = 'numeric';
