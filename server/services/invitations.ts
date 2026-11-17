import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto'
import { and, desc, eq, ilike, inArray, isNull, sql } from 'drizzle-orm'
import { createError } from 'nuxt/server'
import { z } from 'zod'
import type { Actor } from '../../shared/types/access'
import { guardianDelivery, guardianGrant, guardianPhone, account, patient, patientContactIntake, setupToken, user, userRole, visit, visitSharing, visitText } from '../db/schema'
import { useDb } from '../utils/db'
import { recordAudit } from './audit'
import { sendLink, markEmailFailure } from './email'
import { tokenDigest } from './invitation'

export function normalizeGuardianPhone(value: string) {
  const digits = value.replace(/[\s()-]/g, '')
  const normalized = digits.startsWith('+593') ? `0${digits.slice(4)}` : digits
  if (!/^09\d{8}$/.test(normalized)) throw createError({ statusCode: 400, statusMessage: 'Invalid guardian phone' })
  return normalized
}

export const guardianContactSchema = z.strictObject({
  name: z.string().trim().min(2).max(160),
  email: z.string().trim().pipe(z.email().max(254)).transform(value => value.toLowerCase()).optional(),
  phone: z.string().transform(normalizeGuardianPhone).optional(),
  relationship: z.string().trim().min(2).max(80).optional(),
  proof: z.string().trim().min(8).max(500),
  confirmedGuardianId: z.uuid().optional(),
  deferDelivery: z.boolean().optional(),
  intakeId: z.uuid().optional()
}).refine(value => Boolean(value.email || value.phone), { message: 'Email or phone required' })
export type GuardianContact = z.input<typeof guardianContactSchema>
export type GuardianGrant = { patientId: string, status: 'UNINVITED' | 'PENDING' | 'ACTIVE' | 'FAILED', email: string | null }
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
  const grants = await db.select({ name: user.name, relationship: guardianGrant.relationship, email: guardianGrant.contactEmail, status: guardianGrant.status, lastSendError: guardianGrant.lastSendError }).from(guardianGrant).innerJoin(user, eq(user.id, guardianGrant.guardianId)).where(eq(guardianGrant.patientId, patientId))
  return { ...child, guardians: grants }
}

export async function findGuardianIdentity(actor: Actor, identity: string | { email?: string, phone?: string }) {
  await staff(actor)
  const email = typeof identity === 'string' ? identity.trim().toLowerCase() : identity.email?.trim().toLowerCase()
  const phone = typeof identity === 'string' ? undefined : identity.phone ? normalizeGuardianPhone(identity.phone) : undefined
  if (!email && !phone) throw createError({ statusCode: 400, statusMessage: 'Contact required' })
  if (email) z.email().parse(email)
  const db = useDb()
  const byEmail = email ? await db.select({ id: user.id, name: user.name, email: user.email }).from(user).where(sql`lower(btrim(${user.email})) = ${email}`).limit(2) : []
  if (byEmail.length > 1) throw createError({ statusCode: 409, statusMessage: 'Ambiguous guardian identity' })
  const [emailOwner] = byEmail
  const [byPhone] = phone ? await db.select({ id: user.id, name: user.name, email: user.email }).from(guardianPhone).innerJoin(user, eq(user.id, guardianPhone.guardianId)).where(eq(guardianPhone.phone, phone)) : []
  if (emailOwner && byPhone && emailOwner.id !== byPhone.id) throw createError({ statusCode: 409, statusMessage: 'Conflicting guardian identities' })
  const match = emailOwner ?? byPhone
  if (!match) return null
  const [local, domain] = match.email.split('@')
  const [registeredPhone] = await db.select({ phone: guardianPhone.phone }).from(guardianPhone).where(eq(guardianPhone.guardianId, match.id))
  return { id: match.id, name: match.name, maskedContact: match.email.endsWith('@portal.invalid') ? `${registeredPhone?.phone.slice(0, 2) ?? '**'}***${registeredPhone?.phone.slice(-2) ?? '**'}` : `${local!.slice(0, 1)}***@${domain!.slice(0, 1)}***` }
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

function deliveryKey() {
  const secret = process.env.RECOVERY_QUEUE_SECRET
  if (!secret || !/^[a-f\d]{64}$/i.test(secret)) throw createError({ statusCode: 503, statusMessage: 'Delivery encryption unavailable' })
  return Buffer.from(secret, 'hex')
}

function encryptDelivery(value: string) {
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', deliveryKey(), nonce)
  const payload = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  return Buffer.concat([nonce, cipher.getAuthTag(), payload]).toString('base64')
}

function decryptDelivery(value: string) {
  const bytes = Buffer.from(value, 'base64')
  const cipher = createDecipheriv('aes-256-gcm', deliveryKey(), bytes.subarray(0, 12))
  cipher.setAuthTag(bytes.subarray(12, 28))
  return Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString('utf8')
}

export async function processGuardianDelivery(id: string) {
  const db = useDb()
  const [job] = await db.transaction(async (tx) => {
    const [row] = await tx.select().from(guardianDelivery).where(eq(guardianDelivery.id, id)).for('update')
    if (!row || row.state !== 'QUEUED' || !row.payload) return []
    const [owner] = await tx.select({ id: user.id }).from(user).where(eq(user.id, row.guardianId)).for('update')
    if (!owner) return []
    const [link] = await tx.select({ status: guardianGrant.status, tokenId: guardianGrant.tokenId }).from(guardianGrant).where(and(eq(guardianGrant.patientId, row.patientId), eq(guardianGrant.guardianId, row.guardianId)))
    const [newer] = await tx.select({ id: guardianDelivery.id }).from(guardianDelivery).where(and(eq(guardianDelivery.patientId, row.patientId), eq(guardianDelivery.guardianId, row.guardianId), eq(guardianDelivery.state, 'DONE'), sql`(${guardianDelivery.createdAt}, ${guardianDelivery.id}) > (${row.createdAt}, ${row.id})`)).limit(1)
    if (!link || link.status === 'REVOKED' || newer) {
      if (newer && row.tokenId) await tx.update(setupToken).set({ usedAt: new Date() }).where(and(eq(setupToken.id, row.tokenId), isNull(setupToken.usedAt)))
      await tx.update(guardianDelivery).set({ state: 'CANCELLED', payload: null }).where(eq(guardianDelivery.id, id))
      return []
    }
    if (row.tokenId) {
      const [candidate] = await tx.select({ usedAt: setupToken.usedAt, expiresAt: setupToken.expiresAt }).from(setupToken).where(eq(setupToken.id, row.tokenId))
      if (!candidate || candidate.expiresAt <= new Date() || (candidate.usedAt && link.status !== 'FAILED')) {
        await tx.update(guardianDelivery).set({ state: 'CANCELLED', payload: null }).where(eq(guardianDelivery.id, id))
        return []
      }
    }
    return tx.update(guardianDelivery).set({ state: 'SENDING', errorClass: null }).where(eq(guardianDelivery.id, id)).returning()
  })
  if (!job) return null
  let errorClass: string | null = null
  try {
    const { email, token } = JSON.parse(decryptDelivery(job.payload!)) as { email: string, token: string | null }
    const origin = process.env.NUXT_PUBLIC_SITE_URL
    if (!origin) throw new Error('Public deployment URL required')
    await sendLink(email, token ? `${origin.replace(/\/$/, '')}/invitacion/${token}` : `${origin.replace(/\/$/, '')}/acceso`)
  } catch (error) {
    errorClass = error instanceof Error ? error.name : 'Unknown'
  }
  await db.transaction(async (tx) => {
    const [locked] = await tx.select().from(guardianDelivery).where(eq(guardianDelivery.id, id)).for('update')
    if (!locked || locked.state !== 'SENDING') return
    const [owner] = await tx.select({ id: user.id }).from(user).where(eq(user.id, locked.guardianId)).for('update')
    if (!owner) return
    const [link] = await tx.select().from(guardianGrant).where(and(eq(guardianGrant.patientId, locked.patientId), eq(guardianGrant.guardianId, locked.guardianId)))
    const [newer] = await tx.select({ id: guardianDelivery.id }).from(guardianDelivery).where(and(eq(guardianDelivery.patientId, locked.patientId), eq(guardianDelivery.guardianId, locked.guardianId), eq(guardianDelivery.state, 'DONE'), sql`(${guardianDelivery.createdAt}, ${guardianDelivery.id}) > (${locked.createdAt}, ${locked.id})`)).limit(1)
    if (!link || link.status === 'REVOKED' || newer) {
      if (locked.tokenId) await tx.update(setupToken).set({ usedAt: new Date() }).where(and(eq(setupToken.id, locked.tokenId), isNull(setupToken.usedAt)))
      await tx.update(guardianDelivery).set({ state: 'CANCELLED', payload: null }).where(eq(guardianDelivery.id, id))
      return
    }
    if (errorClass) {
      if (locked.tokenId) await tx.update(setupToken).set({ usedAt: new Date() }).where(and(eq(setupToken.id, locked.tokenId), isNull(setupToken.usedAt)))
      await tx.update(guardianGrant).set({ lastSendError: errorClass }).where(and(eq(guardianGrant.patientId, locked.patientId), eq(guardianGrant.guardianId, locked.guardianId)))
      await tx.update(guardianDelivery).set({ state: 'FAILED', errorClass, payload: null }).where(eq(guardianDelivery.id, id))
      return
    }
    if (locked.tokenId) {
      const [candidate] = await tx.select({ usedAt: setupToken.usedAt, expiresAt: setupToken.expiresAt }).from(setupToken).where(eq(setupToken.id, locked.tokenId))
      if (!candidate || candidate.expiresAt <= new Date()) {
        await tx.update(guardianDelivery).set({ state: 'CANCELLED', payload: null }).where(eq(guardianDelivery.id, id))
        return
      }
      if (candidate.usedAt && (link.status !== 'FAILED' || link.tokenId)) {
        await tx.update(guardianDelivery).set({ state: 'CANCELLED', payload: null }).where(eq(guardianDelivery.id, id))
        return
      }
    }
    if (link.status === 'PENDING' && link.tokenId !== locked.tokenId && link.tokenId) await tx.update(setupToken).set({ usedAt: new Date() }).where(and(eq(setupToken.id, link.tokenId), isNull(setupToken.usedAt)))
    const [credential] = await tx.select({ id: account.id }).from(account).where(and(eq(account.userId, locked.guardianId), eq(account.providerId, 'credential')))
    const status = link.status === 'ACTIVE' || (locked.tokenId && credential) ? 'ACTIVE' : locked.tokenId ? 'PENDING' : 'ACTIVE'
    await tx.update(guardianGrant).set({ status, tokenId: link.status === 'ACTIVE' ? link.tokenId : locked.tokenId, lastSendError: null }).where(and(eq(guardianGrant.patientId, locked.patientId), eq(guardianGrant.guardianId, locked.guardianId)))
    await tx.update(guardianDelivery).set({ state: 'DONE', payload: null }).where(eq(guardianDelivery.id, id))
  })
  if (errorClass) {
    await markEmailFailure()
    await recordAudit('GUARDIAN_DELIVERY_FAILED', 'DENIED', job.guardianId, job.patientId)
    console.error(JSON.stringify({ event: 'guardian_invite_failed', provider: 'smtp', errorClass }))
  }
  return errorClass ? 'FAILED' : 'DONE'
}

export async function reconcileGuardianDeliveries() {
  const db = useDb()
  const jobs = await db.select({ id: guardianDelivery.id }).from(guardianDelivery).where(eq(guardianDelivery.state, 'SENDING'))
  for (const job of jobs) await db.update(guardianDelivery).set({ state: 'QUEUED' }).where(and(eq(guardianDelivery.id, job.id), eq(guardianDelivery.state, 'SENDING')))
  return jobs.length
}

export async function processQueuedGuardianDeliveries() {
  const [job] = await useDb().select({ id: guardianDelivery.id }).from(guardianDelivery).where(eq(guardianDelivery.state, 'QUEUED')).orderBy(guardianDelivery.createdAt).limit(1)
  if (!job) return 0
  await processGuardianDelivery(job.id)
  return 1
}

export async function grantGuardian(actor: Actor, patientId: string, input: GuardianContact): Promise<GuardianGrant> {
  await staff(actor, patientId)
  const contact = guardianContactSchema.parse(input)
  const db = useDb()
  const [child] = await db.select({ id: patient.id }).from(patient).where(eq(patient.id, patientId))
  if (!child) throw createError({ statusCode: 404, statusMessage: 'Not found' })
  const matched = await findGuardianIdentity(actor, { email: contact.email, phone: contact.phone })
  if (!matched && contact.confirmedGuardianId) throw createError({ statusCode: 409, statusMessage: 'Identity changed; verify again' })
  if (matched && matched.id !== contact.confirmedGuardianId) {
    await recordAudit('GUARDIAN_GRANT', 'DENIED', actor.id, patientId)
    throw createError({ statusCode: 409, statusMessage: 'Confirm existing guardian identity' })
  }
  const id = matched?.id ?? randomUUID()
  const [existingCredential] = matched ? await db.select({ id: account.id }).from(account).where(and(eq(account.userId, matched.id), eq(account.providerId, 'credential'))) : []
  const token = contact.email && !existingCredential && !contact.deferDelivery ? randomBytes(32).toString('base64url') : null
  const tokenId = token ? randomUUID() : null
  const deliveryId = contact.email && !contact.deferDelivery ? randomUUID() : null
  const payload = contact.email ? encryptDelivery(JSON.stringify({ email: contact.email, token })) : null
  await db.transaction(async (tx) => {
    let owner = matched ? { id: matched.id } : undefined
    if (!owner) {
      if (contact.email) await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${contact.email}, 41422028))`)
      const existingEmail = contact.email ? await tx.select({ id: user.id }).from(user).where(sql`lower(btrim(${user.email})) = ${contact.email}`).limit(1) : []
      if (existingEmail.length) throw createError({ statusCode: 409, statusMessage: 'Identity changed; verify again' })
      const [created] = await tx.insert(user).values({ id, name: contact.name, email: contact.email ?? `${id}@portal.invalid` }).onConflictDoNothing({ target: user.email }).returning({ id: user.id })
      if (!created) throw createError({ statusCode: 409, statusMessage: 'Identity changed; verify again' })
      owner = created
      await tx.insert(userRole).values({ userId: id, role: 'PATIENT' })
    }
    if (contact.phone) {
      const [phoneOwner] = await tx.select().from(guardianPhone).where(eq(guardianPhone.phone, contact.phone))
      if (phoneOwner && phoneOwner.guardianId !== owner.id) throw createError({ statusCode: 409, statusMessage: 'Conflicting guardian phone' })
      if (!phoneOwner) await tx.insert(guardianPhone).values({ guardianId: owner.id, phone: contact.phone })
    }
    const [lockedOwner] = await tx.select({ id: user.id, email: user.email }).from(user).where(eq(user.id, owner.id)).for('update')
    if (!lockedOwner) throw createError({ statusCode: 409, statusMessage: 'Guardian disappeared' })
    if (contact.email && lockedOwner.email !== contact.email) {
      if (!lockedOwner.email.endsWith('@portal.invalid') && lockedOwner.email.trim().toLowerCase() !== contact.email) throw createError({ statusCode: 409, statusMessage: 'Conflicting guardian email' })
      await tx.update(user).set({ email: contact.email }).where(eq(user.id, owner.id))
    }
    const [roles, credentials] = await Promise.all([
      tx.select({ role: userRole.role }).from(userRole).where(eq(userRole.userId, owner.id)),
      tx.select({ id: account.id }).from(account).where(and(eq(account.userId, owner.id), eq(account.providerId, 'credential')))
    ])
    if (roles.some(row => row.role !== 'PATIENT') || !roles.some(row => row.role === 'PATIENT')) throw createError({ statusCode: 403, statusMessage: 'Guardian account not eligible' })
    if (credentials.length && token && matched) throw createError({ statusCode: 409, statusMessage: 'Account already active' })
    const [current] = await tx.select().from(guardianGrant).where(and(eq(guardianGrant.patientId, patientId), eq(guardianGrant.guardianId, owner.id)))
    if (current?.status === 'REVOKED') throw createError({ statusCode: 409, statusMessage: 'Relationship revoked' })
    if (!current) await tx.insert(guardianGrant).values({ patientId, guardianId: owner.id, contactEmail: contact.email ?? lockedOwner.email, contactPhone: contact.phone, relationship: contact.relationship, proof: contact.proof, verifiedBy: actor.id, status: contact.deferDelivery || !contact.email ? 'UNINVITED' : 'FAILED' })
    else await tx.update(guardianGrant).set({ contactEmail: contact.email ?? current.contactEmail, contactPhone: contact.phone ?? current.contactPhone, relationship: contact.relationship ?? current.relationship, proof: contact.proof, verifiedBy: actor.id, verifiedAt: new Date(), ...(deliveryId && current.status === 'UNINVITED' ? { status: 'FAILED' } : {}) }).where(and(eq(guardianGrant.patientId, patientId), eq(guardianGrant.guardianId, owner.id)))
    if (tokenId) await tx.insert(setupToken).values({ id: tokenId, userId: owner.id, digest: tokenDigest(token!), purpose: 'SETUP', expiresAt: new Date(Date.now() + 7 * 86400000) })
    if (deliveryId) await tx.insert(guardianDelivery).values({ id: deliveryId, patientId, guardianId: owner.id, tokenId, payload })
    if (contact.intakeId) {
      const [pending] = await tx.select().from(patientContactIntake).where(and(eq(patientContactIntake.id, contact.intakeId), eq(patientContactIntake.patientId, patientId), eq(patientContactIntake.status, 'LINK_FAILED'))).for('update')
      if (!pending || pending.name !== contact.name || pending.relationship !== contact.relationship || pending.phone !== contact.phone || (pending.email?.trim().toLowerCase() ?? null) !== (contact.email ?? null) || pending.proof !== contact.proof || pending.invite !== Boolean(contact.email && !contact.deferDelivery)) throw createError({ statusCode: 409, statusMessage: 'Pending contact changed' })
      const [intake] = await tx.update(patientContactIntake).set({ status: 'LINKED', guardianId: owner.id, proof: '' }).where(and(eq(patientContactIntake.id, contact.intakeId), eq(patientContactIntake.patientId, patientId), eq(patientContactIntake.status, 'LINK_FAILED'))).returning({ id: patientContactIntake.id })
      if (!intake) throw createError({ statusCode: 409, statusMessage: 'Pending contact changed' })
    }
  })
  const delivery = deliveryId ? await processGuardianDelivery(deliveryId) : null
  const [stored] = await db.select({ status: guardianGrant.status }).from(guardianGrant).where(and(eq(guardianGrant.patientId, patientId), eq(guardianGrant.guardianId, id)))
  await recordAudit('GUARDIAN_GRANT', delivery === 'DONE' ? 'ALLOWED' : 'DENIED', actor.id, patientId)
  return { patientId, email: contact.email ?? null, status: stored?.status === 'ACTIVE' ? 'ACTIVE' : stored?.status === 'PENDING' ? 'PENDING' : stored?.status === 'UNINVITED' ? 'UNINVITED' : 'FAILED' }
}

export async function revokeGuardian(actor: Actor, patientId: string, guardianId: string) {
  await staff(actor, patientId)
  const revoked = await useDb().transaction(async (tx) => {
    const [row] = await tx.update(guardianGrant).set({ status: 'REVOKED', revokedAt: new Date() }).where(and(eq(guardianGrant.patientId, patientId), eq(guardianGrant.guardianId, guardianId), inArray(guardianGrant.status, ['ACTIVE', 'PENDING', 'FAILED', 'UNINVITED']))).returning()
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
  if (!actor.roles.includes('PATIENT')) throw createError({ statusCode: 403, statusMessage: 'Access denied' })
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
  const rows = await db.select({ measuredAt: visit.measuredAt, weightKg: visit.weightKg, lengthHeightCm: visit.lengthHeightCm, position: visit.position, headCircumferenceCm: visit.headCircumferenceCm, parentAdvice: visitText.parentAdvice, nextControlAt: visit.nextControlAt }).from(visit).leftJoin(visitText, eq(visit.id, visitText.visitId)).leftJoin(visitSharing, eq(visitSharing.visitId, visit.id)).where(and(eq(visit.patientId, patientId), sql`coalesce(${visitSharing.shared}, ${visit.shareWithFamily}) = true`)).orderBy(desc(visit.measuredAt), desc(visit.createdAt)).limit(1)
  const visits = rows.map(familyVisit)
  await recordAudit('PORTAL_READ', 'ALLOWED', actor.id, patientId)
  return { ...child, visits }
}
