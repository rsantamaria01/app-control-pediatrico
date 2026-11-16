import { randomUUID } from 'node:crypto'
import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import { createError } from 'nuxt/server'
import type { Actor } from '../../shared/types/access'
import { draftBadge, draftStatus } from '../../shared/types/catalog'
import { complementaryInputSchema, doseInputSchema, type ComplementaryInput, type DoseInput, type DoseRecord, type PendingVaccine } from '../../shared/types/preventive'
import { catalogItem, catalogRelease, complementaryVaccine, guardianGrant, patient, user, vaccineDose } from '../db/schema'
import { useDb } from '../utils/db'
import { recordAudit } from './audit'
import { authorizeClinical } from './patients'

function ageMonths(birth: string, today: Date) {
  const date = today.toISOString().slice(0, 10)
  const [y, m, d] = date.split('-').map(Number)
  const [by, bm, bd] = birth.split('-').map(Number)
  return (y! - by!) * 12 + m! - bm! - (d! < bd! ? 1 : 0)
}
async function currentReleases(kind: string) {
  const releases = await useDb().select().from(catalogRelease).where(eq(catalogRelease.kind, kind)).orderBy(desc(catalogRelease.importedAt), desc(catalogRelease.id))
  const current = new Map<string, typeof catalogRelease.$inferSelect>()
  for (const row of releases) {
    const key = JSON.stringify([row.publisher, row.version, row.url])
    if (!current.has(key)) current.set(key, row)
  }
  return [...current.values()].filter(row => row.status === draftStatus)
}

export async function addComplementaryVaccine(actor: Actor, raw: ComplementaryInput) {
  await authorizeClinical(actor, 'CLINICAL_WRITE', raw.patientId)
  const input = complementaryInputSchema.parse(raw)
  const [person] = await useDb().select({ id: patient.id }).from(patient).where(eq(patient.id, input.patientId))
  if (!person) throw createError({ statusCode: 404, statusMessage: 'Patient not found' })
  const [row] = await useDb().insert(complementaryVaccine).values({ id: randomUUID(), ...input, authorId: actor.id }).returning()
  return { ...row, badge: draftBadge }
}

export async function recordDose(actor: Actor, patientId: string, raw: DoseInput): Promise<DoseRecord> {
  await authorizeClinical(actor, 'CLINICAL_WRITE', patientId)
  const input = doseInputSchema.parse(raw)
  const db = useDb()
  const [person] = await db.select({ id: patient.id, birthDate: patient.birthDate }).from(patient).where(eq(patient.id, patientId))
  if (!person) throw createError({ statusCode: 404, statusMessage: 'Patient not found' })
  if (input.appliedAt > new Date().toISOString().slice(0, 10) || input.appliedAt < person.birthDate) throw createError({ statusCode: 400, statusMessage: 'Invalid application date' })
  let label: string
  let doseLabel: string | null
  let version: string
  let sourcePage: string
  let releaseId: string | null = null
  let key: string
  if (input.complementaryId) {
    const [item] = await db.select().from(complementaryVaccine).where(and(eq(complementaryVaccine.id, input.complementaryId), eq(complementaryVaccine.patientId, patientId)))
    if (!item) throw createError({ statusCode: 404, statusMessage: 'Vaccine not found' })
    label = item.label
    doseLabel = item.doseLabel
    version = 'Registro de la doctora'
    sourcePage = item.source
    key = item.id
  } else {
    const [item] = await db.select({ label: catalogItem.label, doseLabel: catalogItem.doseLabel, doseNumber: catalogItem.doseNumber, sourcePage: catalogItem.sourcePage, status: catalogItem.status, version: catalogRelease.version, kind: catalogRelease.kind }).from(catalogItem).innerJoin(catalogRelease, eq(catalogRelease.id, catalogItem.releaseId)).where(and(eq(catalogItem.releaseId, input.releaseId!), eq(catalogItem.key, input.key!)))
    if (!item || item.kind !== 'VACCINE' || item.status !== draftStatus) throw createError({ statusCode: 404, statusMessage: 'Vaccine not found' })
    label = item.label
    doseLabel = item.doseLabel ?? (item.doseNumber ? `Dosis ${item.doseNumber}` : null)
    version = item.version
    sourcePage = item.sourcePage
    key = input.key!
    releaseId = input.releaseId!
  }
  const [row] = await db.insert(vaccineDose).values({ id: randomUUID(), patientId, releaseId, key, label, doseLabel, catalogVersion: version, sourcePage, sourceStatus: draftStatus, appliedAt: input.appliedAt, external: input.external, lot: input.lot ?? null, privateNote: input.privateNote ?? null, authorId: actor.id }).returning()
  await recordAudit('VACCINE_DOSE', 'ALLOWED', actor.id, patientId)
  return row as DoseRecord
}

export async function listVaccines(actor: Actor, patientId: string, today = new Date()): Promise<{ pending: PendingVaccine[], applied: DoseRecord[] }> {
  await authorizeClinical(actor, 'CLINICAL_READ', patientId)
  const db = useDb()
  const [person] = await db.select({ birthDate: patient.birthDate }).from(patient).where(eq(patient.id, patientId))
  if (!person) throw createError({ statusCode: 404, statusMessage: 'Patient not found' })
  const age = ageMonths(person.birthDate, today)
  const applied = await db.select().from(vaccineDose).where(eq(vaccineDose.patientId, patientId)).orderBy(desc(vaccineDose.appliedAt)) as DoseRecord[]
  const pending: PendingVaccine[] = []
  for (const release of await currentReleases('VACCINE')) {
    const rows = await db.select().from(catalogItem).where(eq(catalogItem.releaseId, release.id)).orderBy(asc(catalogItem.minAgeMonths), asc(catalogItem.key))
    for (const item of rows) {
      if (item.status !== draftStatus || age < Number(item.minAgeMonths) || applied.some(dose => dose.releaseId === item.releaseId && dose.key === item.key)) continue
      pending.push({ kind: 'MSP', id: `${release.id}:${item.key}`, key: item.key, label: item.label, doseLabel: item.doseLabel ?? (item.doseNumber ? `Dosis ${item.doseNumber}` : null), version: release.version, sourcePage: item.sourcePage, source: `${release.publisher} · ${release.title}`, minimumInterval: item.minimumInterval, recommendedAge: item.recommendedAge, status: draftStatus, badge: draftBadge, review: 'PENDING_REVIEW' })
    }
  }
  const complementary = await db.select().from(complementaryVaccine).where(eq(complementaryVaccine.patientId, patientId))
  for (const item of complementary) {
    if (item.status !== draftStatus || applied.some(dose => dose.releaseId === null && dose.key === item.id)) continue
    pending.push({ kind: 'COMPLEMENTARY', id: item.id, key: item.id, label: item.label, doseLabel: item.doseLabel, version: 'Registro de la doctora', sourcePage: item.source, source: item.source, minimumInterval: null, recommendedAge: null, status: draftStatus, badge: draftBadge, review: 'PENDING_REVIEW' })
  }
  return { pending, applied }
}

export async function listAppliedDoses(actor: Actor, patientId: string) {
  const db = useDb()
  if (actor.roles.length !== 1 || actor.roles[0] !== 'PATIENT') throw createError({ statusCode: 404, statusMessage: 'Not found' })
  const [grant] = await db.select({ patientId: guardianGrant.patientId }).from(guardianGrant).where(and(eq(guardianGrant.patientId, patientId), eq(guardianGrant.guardianId, actor.id), eq(guardianGrant.status, 'ACTIVE')))
  await recordAudit('VACCINE_FAMILY_READ', grant ? 'ALLOWED' : 'DENIED', actor.id, patientId)
  if (!grant) throw createError({ statusCode: 404, statusMessage: 'Not found' })
  return db.select({ label: vaccineDose.label, doseLabel: vaccineDose.doseLabel, appliedAt: vaccineDose.appliedAt }).from(vaccineDose).where(eq(vaccineDose.patientId, patientId)).orderBy(desc(vaccineDose.appliedAt))
}

export async function listVaccinationReview(actor: Actor, today = new Date()) {
  await authorizeClinical(actor, 'CLINICAL_READ')
  const db = useDb()
  const people = await db.select({ id: patient.id, name: patient.name, birthDate: patient.birthDate }).from(patient).orderBy(asc(patient.name))
  const releases = await currentReleases('VACCINE')
  const items = releases.length ? await db.select().from(catalogItem).where(inArray(catalogItem.releaseId, releases.map(row => row.id))) : []
  const complementary = await db.select().from(complementaryVaccine)
  const applied = await db.select({ patientId: vaccineDose.patientId, releaseId: vaccineDose.releaseId, key: vaccineDose.key }).from(vaccineDose)
  const candidates = new Set<string>()
  for (const person of people) {
    if (complementary.some(item => item.patientId === person.id && item.status === draftStatus && !applied.some(dose => dose.patientId === person.id && dose.releaseId === null && dose.key === item.id))
      || items.some(item => item.status === draftStatus && ageMonths(person.birthDate, today) >= Number(item.minAgeMonths) && !applied.some(dose => dose.patientId === person.id && dose.releaseId === item.releaseId && dose.key === item.key))) candidates.add(person.id)
  }
  const output: { id: string, name: string, pending: PendingVaccine[], contacts: { name: string, phone: string }[] }[] = []
  for (const person of people.filter(row => candidates.has(row.id))) {
    const { pending } = await listVaccines(actor, person.id, today)
    if (!pending.length) continue
    const contacts = await db.select({ name: user.name, phone: guardianGrant.contactPhone }).from(guardianGrant).innerJoin(user, eq(user.id, guardianGrant.guardianId)).where(and(eq(guardianGrant.patientId, person.id), eq(guardianGrant.status, 'ACTIVE')))
    output.push({ ...person, pending, contacts: contacts.filter(row => row.phone && /^09\d{8}$/.test(row.phone)).map(row => ({ name: row.name, phone: row.phone! })) })
  }
  return output
}
