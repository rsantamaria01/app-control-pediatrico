import { or, eq, and, gt, isNull } from 'drizzle-orm'
import { hashPassword } from 'better-auth/crypto'
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { createClient } from 'redis'
import { Client } from 'pg'
import { account, recoveryJob, session, setupToken, user } from '../db/schema'
import { tokenDigest } from './invitation'
import { validatePassword } from './credentials'
import { useDb } from '../utils/db'
import { sendLink, markEmailFailure } from './email'
import { recordAudit } from './audit'
import { consumeAccessLimit } from './otp-rate-limit'

const message = 'Si la cuenta existe, enviaremos instrucciones al correo registrado'

export async function resetCredential(token: string, password: string) {
  validatePassword(password)
  return useDb().transaction(async (tx) => {
    const [entry] = await tx.update(setupToken).set({ usedAt: new Date() }).where(and(eq(setupToken.digest, tokenDigest(token)), eq(setupToken.purpose, 'RECOVERY'), gt(setupToken.expiresAt, new Date()), isNull(setupToken.usedAt))).returning()
    if (!entry) return false
    await tx.update(account).set({ password: await hashPassword(password) }).where(and(eq(account.userId, entry.userId), eq(account.providerId, 'credential')))
    await tx.delete(session).where(eq(session.userId, entry.userId))
    return true
  })
}

function recoveryKey() {
  const secret = process.env.RECOVERY_QUEUE_SECRET
  if (!secret || !/^[a-f\d]{64}$/i.test(secret)) throw new Error('Recovery queue encryption key unavailable')
  return Buffer.from(secret, 'hex')
}

function encryptIdentity(identity: string) {
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', recoveryKey(), nonce)
  const encrypted = Buffer.concat([cipher.update(identity, 'utf8'), cipher.final()])
  return Buffer.concat([nonce, cipher.getAuthTag(), encrypted]).toString('base64')
}

function decryptIdentity(payload: string) {
  const bytes = Buffer.from(payload, 'base64')
  const decipher = createDecipheriv('aes-256-gcm', recoveryKey(), bytes.subarray(0, 12))
  decipher.setAuthTag(bytes.subarray(12, 28))
  return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8')
}

async function prepareRecovery(job: typeof recoveryJob.$inferSelect) {
  const db = useDb()
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(recoveryJob).where(eq(recoveryJob.id, job.id)).for('update')
    if (!current || current.state !== 'SENDING') return null
    const value = decryptIdentity(current.payload)
    const [owner] = await tx.select({ id: user.id, email: user.email }).from(user).where(or(eq(user.username, value), eq(user.email, value))).limit(1)
    if (!owner) return current
    await tx.select({ id: user.id }).from(user).where(eq(user.id, owner.id)).for('update')
    const [credential] = await tx.select({ id: account.id }).from(account).where(and(eq(account.userId, owner.id), eq(account.providerId, 'credential'))).limit(1)
    if (!credential) return current
    const token = randomBytes(32).toString('base64url')
    const tokenId = crypto.randomUUID()
    await tx.update(setupToken).set({ usedAt: new Date() }).where(and(eq(setupToken.userId, owner.id), eq(setupToken.purpose, 'RECOVERY'), isNull(setupToken.usedAt)))
    await tx.insert(setupToken).values({ id: tokenId, userId: owner.id, digest: tokenDigest(token), purpose: 'RECOVERY', expiresAt: new Date(Date.now() + 600000) })
    const [prepared] = await tx.update(recoveryJob).set({ tokenId, deliveryPayload: encryptIdentity(JSON.stringify({ email: owner.email, token })) }).where(and(eq(recoveryJob.id, current.id), eq(recoveryJob.state, 'SENDING'))).returning()
    return prepared ?? null
  })
}

async function closeRecoveryJob(id: string, state: 'DONE' | 'FAILED' | 'UNKNOWN') {
  return useDb().transaction(async (tx) => {
    const [job] = await tx.select().from(recoveryJob).where(and(eq(recoveryJob.id, id), or(eq(recoveryJob.state, 'SENDING'), eq(recoveryJob.state, 'CLAIMED')))).for('update')
    if (!job) return false
    if (state !== 'DONE' && job.tokenId) {
      await tx.update(setupToken).set({ usedAt: new Date() }).where(and(eq(setupToken.id, job.tokenId), isNull(setupToken.usedAt)))
    }
    await tx.update(recoveryJob).set({ state, payload: '', deliveryPayload: null, completedAt: new Date() }).where(eq(recoveryJob.id, id))
    return true
  })
}

async function logRecoveryFailure(errorClass: string) {
  await markEmailFailure()
  await recordAudit('RECOVERY_DELIVERY_FAILED', 'DENIED')
  console.error(JSON.stringify({ event: 'recovery_delivery_failed', provider: 'smtp', errorClass }))
}

export async function acquireRecoveryWorker() {
  const client = new Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  try {
    const result = await client.query<{ acquired: boolean }>('SELECT pg_try_advisory_lock(734012, 2) AS acquired')
    if (!result.rows[0]?.acquired) {
      await client.end()
      return null
    }
    let active = true
    client.on('error', () => {
      active = false
    })
    client.on('end', () => {
      active = false
    })
    return {
      isActive: async () => {
        if (!active) return false
        try {
          await client.query('SELECT 1')
          return active
        } catch {
          active = false
          return false
        }
      },
      release: async () => {
        active = false
        try {
          await client.query('SELECT pg_advisory_unlock(734012, 2)')
        } finally {
          await client.end()
        }
      }
    }
  } catch (error) {
    await client.end()
    throw error
  }
}

export async function reconcileRecoveryJobs() {
  const db = useDb()
  const interrupted = await db.select({ id: recoveryJob.id }).from(recoveryJob).where(or(eq(recoveryJob.state, 'SENDING'), eq(recoveryJob.state, 'CLAIMED')))
  let count = 0
  for (const job of interrupted) {
    if (await closeRecoveryJob(job.id, 'UNKNOWN')) {
      count++
      await logRecoveryFailure('InterruptedDelivery')
    }
  }
  return count
}

export async function processRecoveryJobs() {
  const db = useDb()
  const [job] = await db.transaction(async (tx) => {
    const [queued] = await tx.select().from(recoveryJob).where(eq(recoveryJob.state, 'QUEUED'))
      .orderBy(recoveryJob.createdAt).limit(1).for('update', { skipLocked: true })
    if (!queued) return []
    return tx.update(recoveryJob).set({ state: 'SENDING', attempts: 1 })
      .where(and(eq(recoveryJob.id, queued.id), eq(recoveryJob.state, 'QUEUED'))).returning()
  })
  if (!job) return 0
  try {
    if (Date.now() - job.createdAt.getTime() <= 600000) {
      const value = decryptIdentity(job.payload)
      const [existing] = await db.select({ id: user.id }).from(user).where(or(eq(user.username, value), eq(user.email, value))).limit(1)
      if (existing) {
        const redis = createClient({ url: process.env.REDIS_URL })
        redis.on('error', () => {})
        try {
          await redis.connect()
          const key = `auth:recovery:cooldown:${createHash('sha256').update(existing.id).digest('hex')}`
          if (job.forced || await redis.set(key, '1', { EX: 60, NX: true })) {
            if (job.forced) await redis.set(key, '1', { EX: 60 })
            const prepared = await prepareRecovery(job)
            if (prepared?.tokenId && prepared.deliveryPayload) {
              const { email, token } = JSON.parse(decryptIdentity(prepared.deliveryPayload)) as { email: string, token: string }
              const origin = process.env.NUXT_PUBLIC_SITE_URL
              if (!origin) throw new Error('Public deployment URL required')
              await sendLink(email, `${origin.replace(/\/$/, '')}/restablecer/${token}`)
            }
          }
        } finally {
          if (redis.isOpen) await redis.quit()
        }
      }
    }
    await closeRecoveryJob(job.id, 'DONE')
  } catch (error) {
    await closeRecoveryJob(job.id, 'FAILED')
    await logRecoveryFailure(error instanceof Error ? error.name : 'Unknown')
  }
  return 1
}

export async function requestForcedRecovery(userId: string) {
  const [owner] = await useDb().select({ email: user.email }).from(user).where(eq(user.id, userId)).limit(1)
  if (!owner) return
  await useDb().insert(recoveryJob).values({ id: crypto.randomUUID(), payload: encryptIdentity(owner.email), forced: true })
}

export async function requestRecovery(identity: string, address?: string) {
  const value = identity.trim().toLowerCase()
  try {
    if (!await consumeAccessLimit(value, address || 'shared', 'recovery')) return { message }
    await useDb().insert(recoveryJob).values({ id: crypto.randomUUID(), payload: encryptIdentity(value) })
  } catch (error) {
    console.error(JSON.stringify({ event: 'recovery_enqueue_failed', errorClass: error instanceof Error ? error.name : 'Unknown' }))
    return { message }
  }
  return { message }
}
