import { randomBytes, randomUUID } from 'node:crypto'
import { and, desc, eq, ilike, inArray, isNull, sql } from 'drizzle-orm'
import { createError } from 'nuxt/server'
import { z } from 'zod'
import type { Actor } from '../../shared/types/access'
import { guardianGrant, account, patient, setupToken, user, userRole, visit, visitSharing, visitText } from '../db/schema'
import { useDb } from '../utils/db'
import { recordAudit } from './audit'
import { sendLink, markEmailFailure } from './email'
import { tokenDigest } from './invitation'

export const guardianContactSchema = z.strictObject({
  name: z.string().trim().min(2).max(160),
  email: z.email().max(254).transform(value => value.toLowerCase()),
  proof: z.string().trim().min(8).max(500),
  confirmedGuardianId: z.uuid().optional()
})
export type GuardianContact = z.input<typeof guardianContactSchema>
export type GuardianGrant = { patientId: string, status: 'PENDING' | 'ACTIVE' | 'FAILED', email: string }
export type FamilyVisit = { measuredAt: string, weightKg: number, lengthHeightCm: number, position: string, headCircumferenceCm: number, parentAdvice?: string, nextControlAt: string | null }
export type FamilyChildView = { id: string, name: string, birthDate: string, visits: FamilyVisit[] }
export type FamilyChildSummary = { id: string, name: string, birthDate: string, lastControl: FamilyVisit | null }

async function staff(actor: Actor, patientId?: string) {
  if (actor.roles.includes('DOCTOR') || actor.roles.includes('ASSISTANT')) return
  await recordAudit('GUARDIAN_GRANT', 'DENIED', actor.id, patientId)
  throw createError({ statusCode: 403, statusMessage: 'Access denied' })
}

export async function getGrantCandidate(actor: Actor, patientId: string) {
  await staff(actor, patientId)
  const db = useDb()
  const [child] = await db.select({ id: patient.id, name: patient.name }).from(patient).where(eq(patient.id, patientId))
  if (!child) throw createError({ statusCode: 404, statusMessage: 'Not found' })
  const grants = await db.select({ email: guardianGrant.contactEmail, status: guardianGrant.status, lastSendError: guardianGrant.lastSendError }).from(guardianGrant).where(eq(guardianGrant.patientId, patientId))
  return { ...child, guardians: grants }
}

export async function findGuardianIdentity(actor: Actor, email: string) {
  await staff(actor)
  const normalized = z.email().parse(email.trim().toLowerCase())
  const [match] = await useDb().select({ id: user.id, name: user.name, email: user.email }).from(user).where(eq(user.email, normalized))
  if (!match) return null
  const [local, domain] = match.email.split('@')
  return { id: match.id, name: match.name, maskedContact: `${local!.slice(0, 1)}***@${domain!.slice(0, 1)}***` }
}

export async function listGrantCandidates(actor: Actor, query: string) {
  await staff(actor)
  const search = query.trim().slice(0, 100).replace(/[\\%_]/g, '\\$&')
  if (search.length < 2) return []
  const db = useDb()
  const children = await db.select({ id: patient.id, name: patient.name }).from(patient).where(ilike(patient.name, `%${search}%`)).limit(20)
  if (!children.length) return []
  const grants = await db.select({ patientId: guardianGrant.patientId, email: guardianGrant.contactEmail, status: guardianGrant.status, lastSendError: guardianGrant.lastSendError }).from(guardianGrant).where(inArray(guardianGrant.patientId, children.map(child => child.id)))
  return children.map(child => ({ ...child, guardians: grants.filter(row => row.patientId === child.id).map(row => ({ email: row.email, status: row.status, lastSendError: row.lastSendError })) }))
}

export async function grantGuardian(actor: Actor, patientId: string, input: GuardianContact): Promise<GuardianGrant> {
  await staff(actor, patientId)
  const contact = guardianContactSchema.parse(input)
  const db = useDb()
  const [child] = await db.select({ id: patient.id }).from(patient).where(eq(patient.id, patientId))
  if (!child) throw createError({ statusCode: 404, statusMessage: 'Not found' })
  let [owner] = await db.select({ id: user.id }).from(user).where(eq(user.email, contact.email))
  if (!owner && contact.confirmedGuardianId) throw createError({ statusCode: 409, statusMessage: 'Identity changed; verify again' })
  if (owner && owner.id !== contact.confirmedGuardianId) {
    await recordAudit('GUARDIAN_GRANT', 'DENIED', actor.id, patientId)
    throw createError({ statusCode: 409, statusMessage: 'Confirm existing guardian identity' })
  }
  if (!owner) {
    const id = randomUUID()
    const [inserted] = await db.insert(user).values({ id, name: contact.name, email: contact.email }).onConflictDoNothing({ target: user.email }).returning({ id: user.id })
    if (!inserted) throw createError({ statusCode: 409, statusMessage: 'Identity changed; verify again' })
    owner = inserted
    await db.insert(userRole).values({ userId: id, role: 'PATIENT' })
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
  if (existing?.status === 'REVOKED') {
    await recordAudit('GUARDIAN_GRANT', 'DENIED', actor.id, patientId)
    return { patientId, status: 'FAILED', email: contact.email }
  }
  const token = credential.length ? null : randomBytes(32).toString('base64url')
  const tokenId = token ? randomUUID() : null
  const origin = process.env.NUXT_PUBLIC_SITE_URL
  let delivered = false
  let lastSendError: string | null = null
  try {
    if (!origin) throw new Error('Public deployment URL required')
    await sendLink(contact.email, token ? `${origin.replace(/\/$/, '')}/invitacion/${token}` : `${origin.replace(/\/$/, '')}/acceso`)
    delivered = true
  } catch (error) {
    lastSendError = error instanceof Error ? error.name : 'Unknown'
    await markEmailFailure()
    await recordAudit('GUARDIAN_DELIVERY_FAILED', 'DENIED', actor.id, patientId)
    console.error(JSON.stringify({ event: 'guardian_invite_failed', provider: 'smtp', errorClass: error instanceof Error ? error.name : 'Unknown' }))
  }
  const status = delivered ? (token ? 'PENDING' : 'ACTIVE') : 'FAILED'
  await db.transaction(async (tx) => {
    const [lockedOwner] = await tx.select({ id: user.id }).from(user).where(eq(user.id, owner.id)).for('update')
    if (!lockedOwner) return
    const [current] = await tx.select().from(guardianGrant).where(and(eq(guardianGrant.patientId, patientId), eq(guardianGrant.guardianId, owner.id)))
    if (current?.status === 'REVOKED') return
    if (current?.status === 'ACTIVE') {
      await tx.update(guardianGrant).set({ lastSendError, verifiedBy: actor.id, verifiedAt: new Date(), proof: contact.proof }).where(and(eq(guardianGrant.patientId, patientId), eq(guardianGrant.guardianId, owner.id)))
      return
    }
    const [nowCredential] = await tx.select({ id: account.id }).from(account).where(and(eq(account.userId, owner.id), eq(account.providerId, 'credential')))
    if (token && nowCredential) return
    if (current?.tokenId) await tx.update(setupToken).set({ usedAt: new Date() }).where(and(eq(setupToken.id, current.tokenId), isNull(setupToken.usedAt)))
    if (tokenId && delivered) await tx.insert(setupToken).values({ id: tokenId, userId: owner.id, digest: tokenDigest(token!), purpose: 'SETUP', expiresAt: new Date(Date.now() + 7 * 86400000) })
    const values = { contactEmail: contact.email, proof: contact.proof, verifiedBy: actor.id, verifiedAt: new Date(), status, tokenId: delivered ? tokenId : null, revokedAt: null, lastSendError }
    if (current) await tx.update(guardianGrant).set(values).where(and(eq(guardianGrant.patientId, patientId), eq(guardianGrant.guardianId, owner.id)))
    else await tx.insert(guardianGrant).values({ patientId, guardianId: owner.id, ...values })
  })
  const [stored] = await db.select({ status: guardianGrant.status }).from(guardianGrant).where(and(eq(guardianGrant.patientId, patientId), eq(guardianGrant.guardianId, owner.id)))
  const outcome = delivered && stored?.status === status ? 'ALLOWED' : 'DENIED'
  await recordAudit('GUARDIAN_GRANT', outcome, actor.id, patientId)
  return { patientId, email: contact.email, status: delivered && stored?.status === 'ACTIVE' ? 'ACTIVE' : outcome === 'ALLOWED' ? status : 'FAILED' }
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

export async function listVisitSharing(actor: Actor, patientId: string) {
  if (!actor.roles.includes('DOCTOR')) throw createError({ statusCode: 403, statusMessage: 'Access denied' })
  const rows = await useDb().select({ id: visit.id, shared: visitSharing.shared }).from(visit).leftJoin(visitSharing, eq(visitSharing.visitId, visit.id)).where(eq(visit.patientId, patientId))
  return Object.fromEntries(rows.filter(row => row.shared !== null).map(row => [row.id, row.shared]))
}

export async function setVisitSharing(actor: Actor, patientId: string, visitId: string, shared: boolean) {
  if (typeof shared !== 'boolean') throw createError({ statusCode: 400, statusMessage: 'Invalid sharing choice' })
  if (!actor.roles.includes('DOCTOR')) {
    await recordAudit('VISIT_SHARING', 'DENIED', actor.id, patientId)
    throw createError({ statusCode: 403, statusMessage: 'Access denied' })
  }
  const db = useDb()
  const [existing] = await db.select({ id: visit.id }).from(visit).where(and(eq(visit.id, visitId), eq(visit.patientId, patientId)))
  if (!existing) {
    await recordAudit('VISIT_SHARING', 'DENIED', actor.id, patientId)
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  }
  await db.insert(visitSharing).values({ visitId, shared, changedBy: actor.id }).onConflictDoUpdate({ target: visitSharing.visitId, set: { shared, changedBy: actor.id, changedAt: new Date() } })
  await recordAudit('VISIT_SHARING', 'ALLOWED', actor.id, patientId)
  return { shared }
}

function requireParent(actor: Actor) {
  if (!actor.roles.includes('PATIENT') || actor.roles.some(role => role !== 'PATIENT')) throw createError({ statusCode: 403, statusMessage: 'Access denied' })
}

export async function listShareableChildren(actor: Actor): Promise<FamilyChildSummary[]> {
  try {
    requireParent(actor)
  } catch (error) {
    await recordAudit('PORTAL_READ', 'DENIED', actor.id)
    throw error
  }
  const db = useDb()
  const rows = await db.select({ id: patient.id, name: patient.name, birthDate: patient.birthDate }).from(guardianGrant).innerJoin(patient, eq(guardianGrant.patientId, patient.id)).where(and(eq(guardianGrant.guardianId, actor.id), eq(guardianGrant.status, 'ACTIVE')))
  const summaries = await Promise.all(rows.map(async (child) => {
    const [last] = await db.select({ measuredAt: visit.measuredAt, weightKg: visit.weightKg, lengthHeightCm: visit.lengthHeightCm, position: visit.position, headCircumferenceCm: visit.headCircumferenceCm, parentAdvice: visitText.parentAdvice, nextControlAt: visit.nextControlAt }).from(visit).leftJoin(visitText, eq(visitText.visitId, visit.id)).leftJoin(visitSharing, eq(visitSharing.visitId, visit.id)).where(and(eq(visit.patientId, child.id), sql`coalesce(${visitSharing.shared}, ${visit.shareWithFamily}) = true`)).orderBy(desc(visit.measuredAt), desc(visit.createdAt)).limit(1)
    return { ...child, lastControl: last ? familyVisit(last) : null }
  }))
  await recordAudit('PORTAL_READ', 'ALLOWED', actor.id)
  return summaries
}

function familyVisit(row: { measuredAt: Date, weightKg: string, lengthHeightCm: string, position: string, headCircumferenceCm: string, parentAdvice: string | null, nextControlAt: Date | null }): FamilyVisit {
  return { measuredAt: row.measuredAt.toISOString(), weightKg: Number(row.weightKg), lengthHeightCm: Number(row.lengthHeightCm), position: row.position, headCircumferenceCm: Number(row.headCircumferenceCm), nextControlAt: row.nextControlAt?.toISOString() ?? null, ...(row.parentAdvice ? { parentAdvice: row.parentAdvice } : {}) }
}

export async function getShareableChild(actor: Actor, patientId: string): Promise<FamilyChildView> {
  try {
    requireParent(actor)
  } catch (error) {
    await recordAudit('PORTAL_READ', 'DENIED', actor.id, patientId)
    throw error
  }
  const db = useDb()
  const [child] = await db.select({ id: patient.id, name: patient.name, birthDate: patient.birthDate }).from(guardianGrant).innerJoin(patient, eq(guardianGrant.patientId, patient.id)).where(and(eq(guardianGrant.guardianId, actor.id), eq(guardianGrant.patientId, patientId), eq(guardianGrant.status, 'ACTIVE')))
  if (!child) {
    await recordAudit('PORTAL_READ', 'DENIED', actor.id, patientId)
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  }
  const rows = await db.select({ measuredAt: visit.measuredAt, weightKg: visit.weightKg, lengthHeightCm: visit.lengthHeightCm, position: visit.position, headCircumferenceCm: visit.headCircumferenceCm, parentAdvice: visitText.parentAdvice, nextControlAt: visit.nextControlAt }).from(visit).leftJoin(visitText, eq(visit.id, visitText.visitId)).leftJoin(visitSharing, eq(visitSharing.visitId, visit.id)).where(and(eq(visit.patientId, patientId), sql`coalesce(${visitSharing.shared}, ${visit.shareWithFamily}) = true`)).orderBy(desc(visit.measuredAt), desc(visit.createdAt)).limit(100)
  const visits = rows.map(familyVisit)
  await recordAudit('PORTAL_READ', 'ALLOWED', actor.id, patientId)
  return { ...child, visits }
}
