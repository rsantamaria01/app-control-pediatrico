import { and, asc, desc, eq, ilike, or, sql } from 'drizzle-orm'
import { createError } from 'nuxt/server'
import type { Actor } from '../../shared/types/access'
import { patientSchema, type PatientInput, type PatientView } from '../../shared/types/measurement'
import { ecuadorIdSchema, normalizePatientName, quickPatientSchema, type QuickPatientInput } from '../../shared/types/patient-registration'
import { patient, visit } from '../db/schema'
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
    [row] = await db.insert(patient).values({ id: crypto.randomUUID(), name: names, givenNames: values.givenNames, surnames: values.surnames, nationalId: values.nationalId, hsmRecord: values.hsmRecord, birthDate: values.birthDate, sex: values.sex, createdBy: actor.id }).returning() as [typeof patient.$inferSelect]
  } catch (error) {
    if ((error as { code?: string, cause?: { code?: string } }).code === '23505' || (error as { cause?: { code?: string } }).cause?.code === '23505') {
      const [existing] = values.nationalId ? await db.select({ id: patient.id }).from(patient).where(eq(patient.nationalId, values.nationalId)) : []
      throw createError({ statusCode: 409, statusMessage: 'Cédula registrada', data: { existingPatientId: existing?.id } })
    }
    throw error
  }
  const contacts = []
  for (const contact of values.contacts) {
    try {
      const result = await grantGuardian(actor, row.id, { name: contact.name, relationship: contact.relationship, phone: contact.phone, ...(contact.email ? { email: contact.email } : {}), deferDelivery: !contact.invite, proof: contact.proof!, ...(contact.confirmedGuardianId ? { confirmedGuardianId: contact.confirmedGuardianId } : {}) })
      contacts.push(result)
    } catch {
      contacts.push({ status: 'FAILED' as const, email: contact.email || null })
    }
  }
  return { patient: toView(row), contacts }
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
