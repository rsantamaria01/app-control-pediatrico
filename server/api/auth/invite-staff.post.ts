import { defineEventHandler, readBody } from 'h3'
import { z } from 'zod'
import { randomBytes, randomUUID, createHash } from 'node:crypto'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { account, setupToken, user, userRole } from '../../db/schema'
import { useDb } from '../../utils/db'
import { requireCapability } from '../../services/access'
import { sendLink, markEmailFailure } from '../../services/email'
import { recordAudit } from '../../services/audit'

export default defineEventHandler(async (event) => {
  const actor = await requireCapability(event, 'ADMINISTER')
  const body = z.object({ email: z.email(), name: z.string().min(1), role: z.enum(['DOCTOR', 'ASSISTANT']) }).parse(await readBody(event))
  const email = body.email.toLowerCase()
  const token = randomBytes(32).toString('base64url')
  const digest = createHash('sha256').update(token).digest('hex')
  const db = useDb()
  const id = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${email}, 41422027))`)
    const [existing] = await tx.select().from(user).where(eq(user.email, email)).for('update')
    let target = existing?.id
    if (existing) {
      const [credential] = await tx.select({ id: account.id }).from(account).where(and(eq(account.userId, existing.id), eq(account.providerId, 'credential')))
      const [role] = await tx.select({ role: userRole.role }).from(userRole).where(eq(userRole.userId, existing.id))
      if (credential || role?.role !== body.role) return null
      await tx.update(setupToken).set({ usedAt: new Date() }).where(and(eq(setupToken.userId, existing.id), eq(setupToken.purpose, 'SETUP'), isNull(setupToken.usedAt)))
    } else {
      target = randomUUID()
      await tx.insert(user).values({ id: target, email, name: body.name })
      await tx.insert(userRole).values({ userId: target, role: body.role })
    }
    await tx.insert(setupToken).values({ id: randomUUID(), userId: target!, purpose: 'SETUP', digest, expiresAt: new Date(Date.now() + 7 * 86400000) })
    return target
  })
  if (id) {
    try {
      const origin = process.env.NUXT_PUBLIC_SITE_URL
      if (!origin) throw new Error('Public deployment URL required')
      await sendLink(email, `${origin.replace(/\/$/, '')}/invitacion/${token}`)
      await recordAudit('STAFF_INVITE', 'ALLOWED', actor.id, id)
    } catch (error) {
      await db.update(setupToken).set({ usedAt: new Date() }).where(and(eq(setupToken.digest, digest), isNull(setupToken.usedAt)))
      await markEmailFailure()
      await recordAudit('STAFF_INVITE', 'DENIED', actor.id, id)
      console.error(JSON.stringify({ event: 'staff_invite_failed', email: 'redacted', provider: 'smtp', errorClass: error instanceof Error ? error.name : 'Unknown' }))
    }
  } else {
    await recordAudit('STAFF_INVITE', 'DENIED', actor.id)
  }
  return { accepted: true }
})
