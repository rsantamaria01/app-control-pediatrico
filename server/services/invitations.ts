import { randomBytes, randomUUID } from 'node:crypto'
import { and, desc, eq, ilike, inArray, isNull } from 'drizzle-orm'
import { createError } from 'nuxt/server'
import { z } from 'zod'
import type { Actor } from '../../shared/types/access'
import type { GrowthResult } from '../../shared/types/clinical'
import { guardianGrant, account, patient, setupToken, user, userRole, visit, visitResult, visitText, whoDataset } from '../db/schema'
import { useDb } from '../utils/db'
import { recordAudit } from './audit'
import { sendLink, markEmailFailure } from './email'
import { tokenDigest } from './invitation'

export const guardianContactSchema = z.strictObject({
  name: z.string().trim().min(2).max(160),
  email: z.email().max(254).transform(value => value.toLowerCase()),
  proof: z.string().trim().min(8).max(500)
})
export type GuardianContact = z.input<typeof guardianContactSchema>
export type GuardianGrant = { patientId: string, status: 'PENDING' | 'ACTIVE' | 'FAILED', email: string }
export type FamilyResult = { indicator: string } & (Pick<Extract<GrowthResult, { status: 'available' }>, 'status' | 'z' | 'percentile'> | { status: 'unavailable' })
export type FamilyVisit = { measuredAt: string, weightKg: number, lengthHeightCm: number, position: string, headCircumferenceCm: number, bmi: number | null, results: FamilyResult[], parentAdvice?: string }
export type FamilyChildView = { id: string, name: string, birthDate: string, sex: string, visits: FamilyVisit[] }

async function staff(actor: Actor, patientId?: string) {
  if (actor.roles.includes('DOCTOR') || actor.roles.includes('ASSISTANT')) return
  await recordAudit('GUARDIAN_GRANT', 'DENIED', actor.id, patientId)
  throw createError({ statusCode: 403, statusMessage: 'Access denied' })
}

export async function listGrantCandidates(actor: Actor, query: string) {
  await staff(actor)
  const search = query.trim().slice(0, 100).replace(/[\\%_]/g, '\\$&')
  if (search.length < 2) return []
  const db = useDb()
  const children = await db.select({ id: patient.id, name: patient.name }).from(patient).where(ilike(patient.name, `%${search}%`)).limit(20)
  if (!children.length) return []
  const grants = await db.select({ patientId: guardianGrant.patientId, email: guardianGrant.contactEmail, status: guardianGrant.status }).from(guardianGrant).where(inArray(guardianGrant.patientId, children.map(child => child.id)))
  return children.map(child => ({ ...child, guardians: grants.filter(row => row.patientId === child.id).map(row => ({ email: row.email, status: row.status })) }))
}

export async function grantGuardian(actor: Actor, patientId: string, input: GuardianContact): Promise<GuardianGrant> {
  await staff(actor, patientId)
  const contact = guardianContactSchema.parse(input)
  const db = useDb()
  const [child] = await db.select({ id: patient.id }).from(patient).where(eq(patient.id, patientId))
  if (!child) throw createError({ statusCode: 404, statusMessage: 'Not found' })
  let [owner] = await db.select({ id: user.id }).from(user).where(eq(user.email, contact.email))
  if (!owner) {
    const id = randomUUID()
    const [inserted] = await db.insert(user).values({ id, name: contact.name, email: contact.email }).onConflictDoNothing({ target: user.email }).returning({ id: user.id })
    owner = inserted ?? (await db.select({ id: user.id }).from(user).where(eq(user.email, contact.email)))[0]
    if (inserted) await db.insert(userRole).values({ userId: id, role: 'PATIENT' })
  }
  if (!owner) throw createError({ statusCode: 503, statusMessage: 'Invite unavailable' })
  const [roles, credential] = await Promise.all([
    db.select({ role: userRole.role }).from(userRole).where(eq(userRole.userId, owner.id)),
    db.select({ id: account.id }).from(account).where(and(eq(account.userId, owner.id), eq(account.providerId, 'credential')))
  ])
  if (roles.some(row => row.role !== 'PATIENT') || !roles.some(row => row.role === 'PATIENT')) {
    await recordAudit('GUARDIAN_GRANT', 'DENIED', actor.id, patientId)
    return { patientId, status: 'FAILED', email: contact.email }
  }
  const [existing] = await db.select().from(guardianGrant).where(and(eq(guardianGrant.patientId, patientId), eq(guardianGrant.guardianId, owner.id)))
  if (existing?.status === 'ACTIVE' || existing?.status === 'REVOKED') {
    await recordAudit('GUARDIAN_GRANT', 'DENIED', actor.id, patientId)
    return { patientId, status: 'FAILED', email: contact.email }
  }
  const token = credential.length ? null : randomBytes(32).toString('base64url')
  const tokenId = token ? randomUUID() : null
  const origin = process.env.NUXT_PUBLIC_SITE_URL
  let delivered = false
  try {
    if (!origin) throw new Error('Public deployment URL required')
    await sendLink(contact.email, token ? `${origin.replace(/\/$/, '')}/invitacion/${token}` : `${origin.replace(/\/$/, '')}/acceso`)
    delivered = true
  } catch (error) {
    await markEmailFailure()
    await recordAudit('GUARDIAN_DELIVERY_FAILED', 'DENIED', actor.id, patientId)
    console.error(JSON.stringify({ event: 'guardian_invite_failed', provider: 'smtp', errorClass: error instanceof Error ? error.name : 'Unknown' }))
  }
  const status = delivered ? (token ? 'PENDING' : 'ACTIVE') : 'FAILED'
  await db.transaction(async (tx) => {
    await tx.select({ id: user.id }).from(user).where(eq(user.id, owner.id)).for('update')
    const [current] = await tx.select().from(guardianGrant).where(and(eq(guardianGrant.patientId, patientId), eq(guardianGrant.guardianId, owner.id)))
    if (current?.status === 'REVOKED' || current?.status === 'ACTIVE') return
    const [nowCredential] = await tx.select({ id: account.id }).from(account).where(and(eq(account.userId, owner.id), eq(account.providerId, 'credential')))
    if (token && nowCredential) return
    if (current?.tokenId) await tx.update(setupToken).set({ usedAt: new Date() }).where(and(eq(setupToken.id, current.tokenId), isNull(setupToken.usedAt)))
    if (tokenId && delivered) await tx.insert(setupToken).values({ id: tokenId, userId: owner.id, digest: tokenDigest(token!), purpose: 'SETUP', expiresAt: new Date(Date.now() + 7 * 86400000) })
    const values = { contactEmail: contact.email, proof: contact.proof, verifiedBy: actor.id, verifiedAt: new Date(), status, tokenId: delivered ? tokenId : null, revokedAt: null }
    if (current) await tx.update(guardianGrant).set(values).where(and(eq(guardianGrant.patientId, patientId), eq(guardianGrant.guardianId, owner.id)))
    else await tx.insert(guardianGrant).values({ patientId, guardianId: owner.id, ...values })
  })
  const [stored] = await db.select({ status: guardianGrant.status }).from(guardianGrant).where(and(eq(guardianGrant.patientId, patientId), eq(guardianGrant.guardianId, owner.id)))
  const outcome = stored?.status === status && delivered ? 'ALLOWED' : 'DENIED'
  await recordAudit('GUARDIAN_GRANT', outcome, actor.id, patientId)
  return { patientId, email: contact.email, status: outcome === 'ALLOWED' ? status : 'FAILED' }
}

export async function revokeGuardian(actor: Actor, patientId: string, guardianId: string) {
  await staff(actor, patientId)
  const revoked = await useDb().transaction(async (tx) => {
    const [row] = await tx.update(guardianGrant).set({ status: 'REVOKED', revokedAt: new Date() }).where(and(eq(guardianGrant.patientId, patientId), eq(guardianGrant.guardianId, guardianId), inArray(guardianGrant.status, ['ACTIVE', 'PENDING', 'FAILED']))).returning()
    if (row?.tokenId) await tx.update(setupToken).set({ usedAt: new Date() }).where(and(eq(setupToken.id, row.tokenId), isNull(setupToken.usedAt)))
    return Boolean(row)
  })
  await recordAudit('GUARDIAN_REVOKE', revoked ? 'ALLOWED' : 'DENIED', actor.id, patientId)
  if (!revoked) throw createError({ statusCode: 404, statusMessage: 'Not found' })
}

function requireParent(actor: Actor) {
  if (!actor.roles.includes('PATIENT') || actor.roles.some(role => role !== 'PATIENT')) throw createError({ statusCode: 403, statusMessage: 'Access denied' })
}

export async function listShareableChildren(actor: Actor): Promise<{ id: string, name: string }[]> {
  try {
    requireParent(actor)
  } catch (error) {
    await recordAudit('PORTAL_READ', 'DENIED', actor.id)
    throw error
  }
  const rows = await useDb().select({ id: patient.id, name: patient.name }).from(guardianGrant).innerJoin(patient, eq(guardianGrant.patientId, patient.id)).where(and(eq(guardianGrant.guardianId, actor.id), eq(guardianGrant.status, 'ACTIVE')))
  await recordAudit('PORTAL_READ', 'ALLOWED', actor.id)
  return rows
}

export async function getShareableChild(actor: Actor, patientId: string): Promise<FamilyChildView> {
  try {
    requireParent(actor)
  } catch (error) {
    await recordAudit('PORTAL_READ', 'DENIED', actor.id, patientId)
    throw error
  }
  const db = useDb()
  const [child] = await db.select({ id: patient.id, name: patient.name, birthDate: patient.birthDate, sex: patient.sex }).from(guardianGrant).innerJoin(patient, eq(guardianGrant.patientId, patient.id)).where(and(eq(guardianGrant.guardianId, actor.id), eq(guardianGrant.patientId, patientId), eq(guardianGrant.status, 'ACTIVE')))
  if (!child) {
    await recordAudit('PORTAL_READ', 'DENIED', actor.id, patientId)
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  }
  const rows = await db.select({ id: visit.id, measuredAt: visit.measuredAt, weightKg: visit.weightKg, lengthHeightCm: visit.lengthHeightCm, position: visit.position, headCircumferenceCm: visit.headCircumferenceCm, bmi: visit.bmi, parentAdvice: visitText.parentAdvice }).from(visit).leftJoin(visitText, eq(visit.id, visitText.visitId)).where(eq(visit.patientId, patientId)).orderBy(desc(visit.measuredAt)).limit(100)
  const visits: FamilyVisit[] = []
  const datasetIds = new Set((await db.select({ id: whoDataset.id }).from(whoDataset).where(eq(whoDataset.sealed, true))).map(dataset => dataset.id))
  for (const row of rows) {
    const results = await db.select({ indicator: visitResult.indicator, snapshot: visitResult.snapshot }).from(visitResult).where(and(eq(visitResult.visitId, row.id), isNull(visitResult.recalculationId), isNull(visitResult.parentResultId)))
    const safeResults: FamilyResult[] = results.map((result) => {
      const snapshot = result.snapshot as Record<string, unknown>
      const reference = snapshot.reference as Record<string, unknown> | undefined
      const age = (row.measuredAt.getTime() - Date.parse(`${child.birthDate}T00:00:00Z`)) / 86400000
      const fifthBirthday = new Date(Date.UTC(Number(child.birthDate.slice(0, 4)) + 5, Number(child.birthDate.slice(5, 7)) - 1, Number(child.birthDate.slice(8, 10))))
      const validReference = reference?.standard === 'WHO_2006' && typeof reference.datasetId === 'string' && datasetIds.has(reference.datasetId) && (!reference.indicator || reference.indicator === result.indicator)
      const validValue = snapshot.status === 'available' && typeof snapshot.z === 'number' && Number.isFinite(snapshot.z) && Math.abs(snapshot.z) <= 6 && typeof snapshot.percentile === 'number' && Number.isFinite(snapshot.percentile) && snapshot.percentile >= 0 && snapshot.percentile <= 100
      if (age < 0 || age > 1856 || row.measuredAt >= fifthBirthday || !validValue || !validReference || snapshot.sex !== child.sex) return { indicator: result.indicator, status: 'unavailable' }
      return { indicator: result.indicator, status: 'available', z: snapshot.z as number, percentile: snapshot.percentile as number }
    })
    const bmiUnsafe = safeResults.some(result => result.indicator === 'BMI_FOR_AGE' && result.status === 'unavailable')
    visits.push({ measuredAt: row.measuredAt.toISOString(), weightKg: Number(row.weightKg), lengthHeightCm: Number(row.lengthHeightCm), position: row.position, headCircumferenceCm: Number(row.headCircumferenceCm), bmi: bmiUnsafe ? null : Number(row.bmi), results: safeResults, ...(row.parentAdvice ? { parentAdvice: row.parentAdvice } : {}) })
  }
  await recordAudit('PORTAL_READ', 'ALLOWED', actor.id, patientId)
  return { ...child, visits }
}
