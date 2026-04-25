// Postgres-only types. Centralised so swapping engines later only
// touches one file.
export const TS_TYPE = 'timestamp' as const;
export const NUMERIC_TYPE = 'numeric' as const;
