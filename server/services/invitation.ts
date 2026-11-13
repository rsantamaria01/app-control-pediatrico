import { createHash, randomBytes } from 'node:crypto'
import { and, eq, gt, isNull } from 'drizzle-orm'
import { hashPassword } from 'better-auth/crypto'
import { account, setupToken, user } from '../db/schema'
import { normalizeUsername, validatePassword } from './credentials'
import { useDb } from '../utils/db'

export function tokenDigest(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

export async function createSetupLink(userId: string, purpose: 'SETUP' | 'RECOVERY', days: number) {
  const token = randomBytes(32).toString('base64url')
  await useDb().insert(setupToken).values({ id: crypto.randomUUID(), userId, purpose, digest: tokenDigest(token), expiresAt: new Date(Date.now() + days * 86400000) })
  const origin = process.env.NUXT_PUBLIC_SITE_URL
  if (!origin) throw new Error('Public deployment URL required')
  return `${origin.replace(/\/$/, '')}/${purpose === 'SETUP' ? 'invitacion' : 'restablecer'}/${token}`
}

export async function setupCredential(token: string, username: string, password: string) {
  const normalized = normalizeUsername(username)
  validatePassword(password)
  const digest = tokenDigest(token)
  return useDb().transaction(async (tx) => {
    const [entry] = await tx.update(setupToken).set({ usedAt: new Date() }).where(and(eq(setupToken.digest, digest), eq(setupToken.purpose, 'SETUP'), gt(setupToken.expiresAt, new Date()), isNull(setupToken.usedAt))).returning()
    if (!entry) return false
    const [existing] = await tx.select({ id: account.id }).from(account).where(and(eq(account.userId, entry.userId), eq(account.providerId, 'credential'))).limit(1)
    if (existing) return false
    await tx.update(user).set({ username: normalized, displayUsername: normalized, emailVerified: true }).where(eq(user.id, entry.userId))
    await tx.insert(account).values({ id: crypto.randomUUID(), userId: entry.userId, accountId: entry.userId, providerId: 'credential', password: await hashPassword(password) })
    return true
  })
}

export async function consumeSetupToken(token: string, purpose: 'SETUP' | 'RECOVERY') {
  const db = useDb()
  const [entry] = await db.select().from(setupToken).where(and(eq(setupToken.digest, tokenDigest(token)), eq(setupToken.purpose, purpose), gt(setupToken.expiresAt, new Date()), isNull(setupToken.usedAt))).limit(1)
  if (!entry) return null
  const [owner] = await db.select().from(user).where(eq(user.id, entry.userId)).limit(1)
  return owner ? { entry, owner } : null
}
