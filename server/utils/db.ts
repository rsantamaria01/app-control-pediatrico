import { drizzle } from 'drizzle-orm/node-postgres'
import * as schema from '../db/schema.js'

let _db: ReturnType<typeof drizzle<typeof schema>> | undefined

export function useDb() {
  if (!_db) {
    _db = drizzle(process.env.DATABASE_URL!, { schema })
  }
  return _db
}
