import { desc, eq, ilike } from 'drizzle-orm'
import { createError } from 'nuxt/server'
import type { Actor } from '../../shared/types/access'
import { patientSchema, type PatientInput, type PatientView } from '../../shared/types/measurement'
import { patient } from '../db/schema'
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
  const search = query.trim().slice(0, 100).replace(/[\\%_]/g, '\\$&')
  const rows = await useDb().select().from(patient).where(search ? ilike(patient.name, `%${search}%`) : undefined).orderBy(desc(patient.createdAt)).limit(100)
  return rows.map(toView)
}
