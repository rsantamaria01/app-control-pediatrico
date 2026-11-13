import { drizzle } from 'drizzle-orm/node-postgres'
import { eq, sql } from 'drizzle-orm'
import { randomBytes, createHash } from 'node:crypto'
import { Pool } from 'pg'
import { auditEvent, bootstrapMarker, setupToken, user, userRole } from '../server/db/schema.ts'
import { normalizeUsername } from '../server/services/credentials.ts'

const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase()
const username = normalizeUsername(process.env.BOOTSTRAP_ADMIN_USERNAME || '')
const url = process.env.DATABASE_URL
const siteUrl = process.env.NUXT_PUBLIC_SITE_URL
if (!email || !url || !siteUrl || !/^https:\/\//.test(siteUrl) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Valid bootstrap email, database and HTTPS public URL required')
const pool = new Pool({ connectionString: url })
const token = randomBytes(32).toString('base64url')
try {
  const db = drizzle(pool)
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(41422026)`)
    const existing = await tx.select().from(bootstrapMarker).where(eq(bootstrapMarker.id, 'admin')).limit(1)
    if (existing.length) throw new Error('Admin bootstrap already completed')
    const existingUsers = await tx.select({ id: user.id }).from(user).limit(1)
    if (existingUsers.length) throw new Error('Admin bootstrap requires an empty user table')
    const id = crypto.randomUUID()
    await tx.insert(user).values({ id, email, name: username, username, displayUsername: username, emailVerified: false })
    await tx.insert(userRole).values({ userId: id, role: 'ADMIN' })
    await tx.insert(setupToken).values({ id: crypto.randomUUID(), userId: id, purpose: 'SETUP', digest: createHash('sha256').update(token).digest('hex'), expiresAt: new Date(Date.now() + 7 * 86400000) })
    await tx.insert(bootstrapMarker).values({ id: 'admin', userId: id })
    await tx.insert(auditEvent).values({ id: crypto.randomUUID(), actorId: id, action: 'ADMIN_BOOTSTRAP', outcome: 'ALLOWED' })
  })
  process.stdout.write(`${siteUrl.replace(/\/$/, '')}/invitacion/${token}\n`)
} finally {
  await pool.end()
}
