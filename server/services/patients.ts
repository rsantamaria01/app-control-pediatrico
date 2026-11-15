import { and, asc, desc, eq, ilike, or, sql } from 'drizzle-orm'
import { createError } from 'nuxt/server'
import type { Actor } from '../../shared/types/access'
import { patientSchema, type PatientInput, type PatientView } from '../../shared/types/measurement'
import { ecuadorIdSchema, normalizePatientName, quickPatientSchema, type QuickPatientInput } from '../../shared/types/patient-registration'
import { guardianGrant, patient, patientContactIntake, visit } from '../db/schema'
import { findGuardianIdentity, grantGuardian } from './invitations'
import { useDb } from '../utils/db'
import { recordAudit } from './audit'

export async function authorizeClinical(actor: Actor, action: 'CLINICAL_READ' | 'CLINICAL_WRITE', subjectId?: string) {
  const allowed = actor.roles.includes('DOCTOR')
  await recordAudit(action, allowed ? 'ALLOWED' : 'DENIED', actor.id, subjectId)
  if (!allowed) throw createError({ statusCode: 403, statusMessage: 'Access denied' })
}

function toView(row: typeof patient.$inferSelect): PatientView {
  return {
    id: row.id, name: row.name, birthDate: row.birthDate, sex: row.sex as PatientView['sex'],
    ...(row.givenNames ? { givenNames: row.givenNames } : {}), ...(row.surnames ? { surnames: row.surnames } : {}),
    ...(row.nationalId ? { nationalId: row.nationalId } : {}), ...(row.hsmRecord ? { hsmRecord: row.hsmRecord } : {}),
    ...(row.perinatalNotes ? { perinatalNotes: row.perinatalNotes } : {}),
    gestationDays: row.gestationDays ?? undefined, correctionUntilMonths: row.correctionUntilMonths as 24 | 36,
    birthWeightKg: row.birthWeightKg === null ? undefined : Number(row.birthWeightKg),
    birthLengthCm: row.birthLengthCm === null ? undefined : Number(row.birthLengthCm),
    birthHeadCircumferenceCm: row.birthHeadCircumferenceCm === null ? undefined : Number(row.birthHeadCircumferenceCm),
    createdBy: row.createdBy
  }
}

export async function createPatient(actor: Actor, input: PatientInput): Promise<PatientView> {
  await authorizeClinical(actor, 'CLINICAL_WRITE')
  const values = patientSchema.parse(input)
  if (values.birthDate > new Date().toISOString().slice(0, 10)) throw createError({ statusCode: 400, statusMessage: 'Invalid birth date' })
  const [row] = await useDb().insert(patient).values({
    id: crypto.randomUUID(), name: values.name, birthDate: values.birthDate, sex: values.sex,
    gestationDays: values.gestationDays, correctionUntilMonths: values.correctionUntilMonths,
    birthWeightKg: values.birthWeightKg?.toString(), birthLengthCm: values.birthLengthCm?.toString(),
    birthHeadCircumferenceCm: values.birthHeadCircumferenceCm?.toString(), createdBy: actor.id
  }).returning()
  return toView(row!)
}

export async function getPatient(actor: Actor, id: string): Promise<PatientView> {
  await authorizeClinical(actor, 'CLINICAL_READ', id)
  const [row] = await useDb().select().from(patient).where(eq(patient.id, id))
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Patient not found' })
  return toView(row)
}

export async function listPatients(actor: Actor, query = ''): Promise<PatientView[]> {
  await authorizeClinical(actor, 'CLINICAL_READ')
  const search = normalizePatientName(query).slice(0, 100).replace(/[\\%_]/g, '\\$&')
  const db = useDb()
  const rows = await db.select().from(patient).where(search ? or(ilike(sql`unaccent(${patient.name})`, `%${search}%`), ilike(patient.nationalId, `%${search}%`)) : undefined).orderBy(asc(sql`unaccent(${patient.name})`), asc(patient.id)).limit(100)
  return Promise.all(rows.map(async (row) => {
    const [last] = await db.select({ weightKg: visit.weightKg }).from(visit).where(eq(visit.patientId, row.id)).orderBy(desc(visit.measuredAt), desc(visit.createdAt)).limit(1)
    return { ...toView(row), ...(last ? { lastWeightKg: Number(last.weightKg) } : {}) }
  }))
}

export async function createQuickPatient(actor: Actor, input: QuickPatientInput) {
  await authorizeClinical(actor, 'CLINICAL_WRITE')
  const values = quickPatientSchema.parse(input)
  if (values.birthDate > new Date().toISOString().slice(0, 10) || !Number.isFinite(Date.parse(`${values.birthDate}T00:00:00Z`)) || new Date(`${values.birthDate}T00:00:00Z`).toISOString().slice(0, 10) !== values.birthDate) throw createError({ statusCode: 400, statusMessage: 'Invalid birth date' })
  const db = useDb()
  const names = `${values.givenNames} ${values.surnames}`
  if (values.nationalId) {
    const [existing] = await db.select({ id: patient.id }).from(patient).where(eq(patient.nationalId, values.nationalId))
    if (existing) throw createError({ statusCode: 409, statusMessage: 'Cédula registrada', data: { existingPatientId: existing.id } })
  } else {
    const matches = await db.select({ id: patient.id, name: patient.name }).from(patient).where(and(eq(patient.birthDate, values.birthDate), eq(sql`lower(unaccent(regexp_replace(${patient.name}, '[[:space:]]+', ' ', 'g')))`, normalizePatientName(names)))).limit(10)
    if (matches.length && !values.confirmPossibleMatches) throw createError({ statusCode: 409, statusMessage: 'Posibles coincidencias', data: { possibleMatches: matches } })
  }
  for (const contact of values.contacts) {
    const existing = await findGuardianIdentity(actor, { email: contact.email || undefined, phone: contact.phone })
    if (existing?.id !== contact.confirmedGuardianId || (!existing && contact.confirmedGuardianId)) throw createError({ statusCode: 409, statusMessage: 'Confirme la identidad del representante' })
    if (!contact.proof) throw createError({ statusCode: 400, statusMessage: 'Verifique el vínculo familiar' })
  }
  let row: typeof patient.$inferSelect
  try {
    row = await db.transaction(async (tx) => {
      const [created] = await tx.insert(patient).values({ id: crypto.randomUUID(), name: names, givenNames: values.givenNames, surnames: values.surnames, nationalId: values.nationalId, hsmRecord: values.hsmRecord, birthDate: values.birthDate, sex: values.sex, createdBy: actor.id }).returning()
      await tx.insert(patientContactIntake).values(values.contacts.map((contact, position) => ({ id: crypto.randomUUID(), patientId: created!.id, position, name: contact.name, relationship: contact.relationship, phone: contact.phone, email: contact.email || null, proof: contact.proof!, invite: contact.invite, createdBy: actor.id })))
      return created!
    })
  } catch (error) {
    if ((error as { code?: string, cause?: { code?: string } }).code === '23505' || (error as { cause?: { code?: string } }).cause?.code === '23505') {
      const [existing] = values.nationalId ? await db.select({ id: patient.id }).from(patient).where(eq(patient.nationalId, values.nationalId)) : []
      throw createError({ statusCode: 409, statusMessage: 'Cédula registrada', data: { existingPatientId: existing?.id } })
    }
    throw error
  }
  const intakes = await db.select().from(patientContactIntake).where(eq(patientContactIntake.patientId, row.id)).orderBy(asc(patientContactIntake.position))
  const contacts = []
  for (const [index, contact] of values.contacts.entries()) {
    const intake = intakes[index]!
    try {
      const result = await grantGuardian(actor, row.id, { name: contact.name, relationship: contact.relationship, phone: contact.phone, ...(contact.email ? { email: contact.email } : {}), deferDelivery: !contact.invite, proof: contact.proof!, intakeId: intake.id, ...(contact.confirmedGuardianId ? { confirmedGuardianId: contact.confirmedGuardianId } : {}) })
      contacts.push(result)
    } catch {
      const linked = await linkedIntakeStatus(row.id, intake.id)
      contacts.push(linked ?? { status: 'LINK_FAILED' as const, email: contact.email || null })
    }
  }
  return { patient: toView(row), contacts }
}

async function linkedIntakeStatus(patientId: string, intakeId: string) {
  const db = useDb()
  const [linked] = await db.select({ guardianId: patientContactIntake.guardianId }).from(patientContactIntake).where(and(eq(patientContactIntake.id, intakeId), eq(patientContactIntake.patientId, patientId), eq(patientContactIntake.status, 'LINKED')))
  if (!linked?.guardianId) return null
  const [grant] = await db.select({ status: guardianGrant.status, email: guardianGrant.contactEmail }).from(guardianGrant).where(and(eq(guardianGrant.patientId, patientId), eq(guardianGrant.guardianId, linked.guardianId)))
  if (!grant) throw createError({ statusCode: 503, statusMessage: 'Grant state unavailable' })
  return { status: grant.status, email: grant.email.endsWith('@portal.invalid') ? null : grant.email }
}

export async function listPendingContacts(actor: Actor, patientId: string) {
  await authorizeClinical(actor, 'CLINICAL_READ', patientId)
  const db = useDb()
  const [child] = await db.select({ id: patient.id }).from(patient).where(eq(patient.id, patientId))
  if (!child) throw createError({ statusCode: 404, statusMessage: 'Patient not found' })
  return db.select({ id: patientContactIntake.id, name: patientContactIntake.name, relationship: patientContactIntake.relationship, phone: patientContactIntake.phone, email: patientContactIntake.email, status: patientContactIntake.status }).from(patientContactIntake).where(and(eq(patientContactIntake.patientId, patientId), eq(patientContactIntake.status, 'LINK_FAILED'))).orderBy(asc(patientContactIntake.position))
}

export async function retryPendingContact(actor: Actor, patientId: string, intakeId: string, confirmation: { confirmedGuardianId?: string, phone?: string, email?: string, name?: string, relationship?: string, proof?: string }) {
  await authorizeClinical(actor, 'CLINICAL_WRITE', patientId)
  const db = useDb()
  const [row] = await db.select().from(patientContactIntake).where(and(eq(patientContactIntake.id, intakeId), eq(patientContactIntake.patientId, patientId), eq(patientContactIntake.status, 'LINK_FAILED')))
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Pending contact not found' })
  const changed = confirmation.phone !== undefined || confirmation.email !== undefined || confirmation.name !== undefined || confirmation.relationship !== undefined
  if (changed && (!confirmation.proof || confirmation.proof.trim().length < 8)) throw createError({ statusCode: 400, statusMessage: 'Verifique nuevamente el vínculo' })
  const details = {
    name: confirmation.name ?? row.name, relationship: confirmation.relationship ?? row.relationship,
    phone: confirmation.phone ?? row.phone, email: confirmation.email === undefined ? row.email ?? '' : confirmation.email, proof: confirmation.proof ?? row.proof
  }
  const normalized = quickPatientSchema.shape.contacts.element.safeParse({ ...details, invite: Boolean(row.invite && details.email) })
  if (!normalized.success) throw createError({ statusCode: 400, statusMessage: 'Contacto inválido' })
  await db.update(patientContactIntake).set({ name: normalized.data.name, relationship: normalized.data.relationship, phone: normalized.data.phone, email: normalized.data.email || null, proof: normalized.data.proof!, invite: Boolean(row.invite && normalized.data.email) }).where(and(eq(patientContactIntake.id, intakeId), eq(patientContactIntake.status, 'LINK_FAILED')))
  const matched = await findGuardianIdentity(actor, { email: normalized.data.email || undefined, phone: normalized.data.phone })
  if (matched?.id !== confirmation.confirmedGuardianId || (!matched && confirmation.confirmedGuardianId)) throw createError({ statusCode: 409, statusMessage: 'Confirme la identidad del representante' })
  try {
    return await grantGuardian(actor, patientId, { name: normalized.data.name, phone: normalized.data.phone, relationship: normalized.data.relationship, proof: normalized.data.proof!, ...(normalized.data.email ? { email: normalized.data.email } : {}), deferDelivery: !normalized.data.invite, intakeId, ...(confirmation.confirmedGuardianId ? { confirmedGuardianId: confirmation.confirmedGuardianId } : {}) })
  } catch (error) {
    const linked = await linkedIntakeStatus(patientId, intakeId)
    if (linked) return { patientId, ...linked }
    throw error
  }
}

export async function updatePatientIdentity(actor: Actor, id: string, nationalId: string) {
  await authorizeClinical(actor, 'CLINICAL_WRITE', id)
  const validated = ecuadorIdSchema.parse(nationalId)
  const db = useDb()
  const [existing] = await db.select({ id: patient.id }).from(patient).where(eq(patient.nationalId, validated))
  if (existing && existing.id !== id) throw createError({ statusCode: 409, statusMessage: 'Cédula registrada', data: { existingPatientId: existing.id } })
  try {
    const [row] = await db.update(patient).set({ nationalId: validated }).where(eq(patient.id, id)).returning()
    if (!row) throw createError({ statusCode: 404, statusMessage: 'Patient not found' })
    return toView(row)
  } catch (error) {
    if ((error as { code?: string }).code === '23505') throw createError({ statusCode: 409, statusMessage: 'Cédula registrada' })
    throw error
  }
}

export async function updatePatientBackground(actor: Actor, id: string, input: Omit<PatientInput, 'name' | 'sex' | 'birthDate'> & { perinatalNotes?: string }) {
  await authorizeClinical(actor, 'CLINICAL_WRITE', id)
  const db = useDb()
  const [existing] = await db.select().from(patient).where(eq(patient.id, id))
  if (!existing) throw createError({ statusCode: 404, statusMessage: 'Patient not found' })
  const { perinatalNotes, ...measurements } = input
  if (measurements.correctionUntilMonths === 36 && measurements.gestationDays === undefined && existing.gestationDays === null) throw createError({ statusCode: 400, statusMessage: 'Gestation required' })
  const values = patientSchema.parse({ name: existing.name, sex: existing.sex, birthDate: existing.birthDate, gestationDays: existing.gestationDays ?? undefined, correctionUntilMonths: existing.correctionUntilMonths, birthWeightKg: existing.birthWeightKg === null ? undefined : Number(existing.birthWeightKg), birthLengthCm: existing.birthLengthCm === null ? undefined : Number(existing.birthLengthCm), birthHeadCircumferenceCm: existing.birthHeadCircumferenceCm === null ? undefined : Number(existing.birthHeadCircumferenceCm), ...measurements })
  const [row] = await db.update(patient).set({ gestationDays: values.gestationDays ?? null, correctionUntilMonths: values.correctionUntilMonths, birthWeightKg: values.birthWeightKg?.toString() ?? null, birthLengthCm: values.birthLengthCm?.toString() ?? null, birthHeadCircumferenceCm: values.birthHeadCircumferenceCm?.toString() ?? null, perinatalNotes: perinatalNotes === undefined ? existing.perinatalNotes : perinatalNotes.trim() }).where(eq(patient.id, id)).returning()
  return toView(row!)
}
