import { defineEventHandler, readBody } from 'h3'
import { z } from 'zod'
import { staffInviteSchema } from '../../../shared/types/admin'
import { randomBytes, randomUUID, createHash } from 'node:crypto'
import { Client } from 'pg'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { account, setupToken, user, userRole } from '../../db/schema'
import { useDb } from '../../utils/db'
import { requireCapability } from '../../services/access'
import { sendLink, markEmailFailure } from '../../services/email'
import { recordAudit } from '../../services/audit'

export default defineEventHandler(async (event) => {
  const actor = await requireCapability(event, 'ADMINISTER')
  const input = await readBody(event)
  const body = input && typeof input === 'object' && 'roles' in input ? staffInviteSchema.parse(input) : staffInviteSchema.parse({ ...z.object({ email: z.string(), name: z.string(), role: z.enum(['DOCTOR', 'ASSISTANT']) }).parse(input), roles: [input.role] })
  const email = body.email.trim().toLowerCase()
  const token = randomBytes(32).toString('base64url')
  const digest = createHash('sha256').update(token).digest('hex')
  const db = useDb()
  const lock = new Client({ connectionString: process.env.DATABASE_URL })
  let targetId: string | undefined
  let connected = false
  try {
    await lock.connect()
    connected = true
    await lock.query('SELECT pg_advisory_lock(hashtextextended($1, 41422027))', [email])
    const result = await db.transaction(async (tx) => {
      const existingUsers = await tx.select().from(user).where(sql`lower(btrim(${user.email})) = ${email}`).limit(2)
      if (existingUsers.length > 1) return null
      const [existing] = existingUsers
      let target = existing?.id
      if (existing) {
        const [credential] = await tx.select({ id: account.id }).from(account).where(and(eq(account.userId, existing.id), eq(account.providerId, 'credential')))
        const assigned = await tx.select({ role: userRole.role }).from(userRole).where(eq(userRole.userId, existing.id))
        if (credential || assigned.length !== body.roles.length || assigned.some(row => !body.roles.includes(row.role as typeof body.roles[number]))) return null
      } else {
        target = randomUUID()
        await tx.insert(user).values({ id: target, email, name: body.name })
        await tx.insert(userRole).values(body.roles.map(role => ({ userId: target!, role })))
      }
      targetId = target
      return target!
    })
    if (!result) {
      await recordAudit('STAFF_INVITE', 'DENIED', actor.id)
      return { accepted: true }
    }
    const origin = process.env.NUXT_PUBLIC_SITE_URL
    if (!origin) throw new Error('Public deployment URL required')
    await sendLink(email, `${origin.replace(/\/$/, '')}/invitacion/${token}`)
    const committed = await db.transaction(async (tx) => {
      await tx.select({ id: user.id }).from(user).where(eq(user.id, result)).for('update')
      const [credential] = await tx.select({ id: account.id }).from(account).where(and(eq(account.userId, result), eq(account.providerId, 'credential'))).limit(1)
      if (credential) return false
      await tx.insert(setupToken).values({ id: randomUUID(), userId: result, purpose: 'SETUP', digest, expiresAt: new Date(Date.now() + 7 * 86400000) })
      await tx.update(setupToken).set({ usedAt: new Date() }).where(and(eq(setupToken.userId, result), eq(setupToken.purpose, 'SETUP'), isNull(setupToken.usedAt), sql`${setupToken.digest} <> ${digest}`))
      return true
    })
    await recordAudit('STAFF_INVITE', committed ? 'ALLOWED' : 'DENIED', actor.id, result)
    if (!committed) console.error(JSON.stringify({ event: 'staff_invite_failed', provider: 'smtp', errorClass: 'ConcurrentSetup' }))
  } catch (error) {
    await markEmailFailure()
    await recordAudit('STAFF_INVITE', 'DENIED', actor.id, targetId)
    console.error(JSON.stringify({ event: 'staff_invite_failed', email: 'redacted', provider: 'smtp', errorClass: error instanceof Error ? error.name : 'Unknown' }))
  } finally {
    if (connected) await lock.end()
  }
  return { accepted: true }
})
