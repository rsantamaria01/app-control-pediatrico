import { drizzle } from 'drizzle-orm/node-postgres'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { randomBytes, createHash, createDecipheriv } from 'node:crypto'
import { hashPassword } from 'better-auth/crypto'
import { Pool } from 'pg'
import { account, auditEvent, bootstrapMarker, recoveryJob, session, setupToken, user, userRole, verification } from '../server/db/schema.ts'
import { normalizeUsername } from '../server/services/credentials.ts'

const flags = process.argv.slice(2)
if (flags.some(flag => !['--generated-password', '--reset-admin'].includes(flag)) || new Set(flags).size !== flags.length || (flags.includes('--reset-admin') && !flags.includes('--generated-password'))) throw new Error('Use --generated-password to create a credential; --reset-admin requires --generated-password')
const generated = flags.includes('--generated-password')
const reset = flags.includes('--reset-admin')
const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase()
const username = normalizeUsername(process.env.BOOTSTRAP_ADMIN_USERNAME || '')
const url = process.env.DATABASE_URL
const siteUrl = process.env.NUXT_PUBLIC_SITE_URL
if (!email || !url || (!generated && (!siteUrl || !/^https:\/\//.test(siteUrl))) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Valid bootstrap email, database and HTTPS public URL required')
const pool = new Pool({ connectionString: url })
const secret = randomBytes(32).toString('base64url')
function recoveryIdentity(payload: string) {
  try {
    const key = process.env.RECOVERY_QUEUE_SECRET
    if (!key || !/^[a-f\d]{64}$/i.test(key)) return null
    const bytes = Buffer.from(payload, 'base64')
    const decipher = createDecipheriv('aes-256-gcm', Buffer.from(key, 'hex'), bytes.subarray(0, 12))
    decipher.setAuthTag(bytes.subarray(12, 28))
    return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8')
  } catch {
    return null
  }
}
try {
  const db = drizzle(pool)
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(41422026)`)
    const [marker] = await tx.select().from(bootstrapMarker).where(eq(bootstrapMarker.id, 'admin')).limit(1)
    if (reset) {
      if (!marker) throw new Error('Admin bootstrap marker not found')
      const [owner] = await tx.select().from(user).where(eq(user.id, marker.userId)).for('update')
      const [role] = await tx.select().from(userRole).where(and(eq(userRole.userId, marker.userId), eq(userRole.role, 'ADMIN'))).limit(1)
      const credentials = await tx.select().from(account).where(and(eq(account.userId, marker.userId), eq(account.providerId, 'credential')))
      if (!owner || owner.username !== username || owner.email !== email || !role || credentials.length !== 1) throw new Error('Bootstrap admin identity or credential mismatch')
      const tokens = await tx.select({ id: setupToken.id }).from(setupToken).where(eq(setupToken.userId, owner.id))
      const tokenIds = tokens.map(entry => entry.id)
      const pendingJobs = await tx.select().from(recoveryJob).where(inArray(recoveryJob.state, ['QUEUED', 'CLAIMED', 'SENDING']))
      const jobIds = pendingJobs.filter((job) => {
        if (job.tokenId && tokenIds.includes(job.tokenId)) return true
        const identity = recoveryIdentity(job.payload)
        if (identity === null) throw new Error('Cannot safely identify pending recovery jobs')
        return identity === owner.email || identity === owner.username
      }).map(job => job.id)
      if (jobIds.length) await tx.update(recoveryJob).set({ state: 'FAILED', payload: '', deliveryPayload: null, completedAt: new Date() }).where(inArray(recoveryJob.id, jobIds))
      await tx.delete(setupToken).where(eq(setupToken.userId, owner.id))
      await tx.delete(verification).where(inArray(verification.identifier, [owner.email, owner.username]))
      await tx.delete(session).where(eq(session.userId, owner.id))
      await tx.update(account).set({ password: await hashPassword(secret), updatedAt: new Date() }).where(eq(account.id, credentials[0]!.id))
      await tx.insert(auditEvent).values({ id: crypto.randomUUID(), actorId: owner.id, action: 'ADMIN_BOOTSTRAP_RESET', outcome: 'ALLOWED' })
      return
    }
    if (marker) throw new Error('Admin bootstrap already completed')
    const existingUsers = await tx.select({ id: user.id }).from(user).limit(1)
    if (existingUsers.length) throw new Error('Admin bootstrap requires an empty user table')
    const id = crypto.randomUUID()
    await tx.insert(user).values({ id, email, name: username, username, displayUsername: username, emailVerified: false })
    await tx.insert(userRole).values({ userId: id, role: 'ADMIN' })
    if (generated) await tx.insert(account).values({ id: crypto.randomUUID(), userId: id, accountId: id, providerId: 'credential', password: await hashPassword(secret) })
    else await tx.insert(setupToken).values({ id: crypto.randomUUID(), userId: id, purpose: 'SETUP', digest: createHash('sha256').update(secret).digest('hex'), expiresAt: new Date(Date.now() + 7 * 86400000) })
    await tx.insert(bootstrapMarker).values({ id: 'admin', userId: id })
    await tx.insert(auditEvent).values({ id: crypto.randomUUID(), actorId: id, action: 'ADMIN_BOOTSTRAP', outcome: 'ALLOWED' })
  })
  process.stdout.write(generated ? `${secret}\n` : `${siteUrl!.replace(/\/$/, '')}/invitacion/${secret}\n`)
} finally {
  await pool.end()
}
