import { randomUUID } from 'node:crypto'
import { and, asc, desc, eq } from 'drizzle-orm'
import { createError } from 'nuxt/server'
import type { Actor } from '../../shared/types/access'
import { draftBadge, draftStatus } from '../../shared/types/catalog'
import { complementaryInputSchema, doseInputSchema, type ComplementaryInput, type DoseInput, type DoseRecord, type PendingVaccine } from '../../shared/types/preventive'
import { auditEvent, catalogItem, catalogRelease, complementaryVaccine, guardianGrant, patient, user, vaccineDose } from '../db/schema'
import { useDb } from '../utils/db'
import { recordAudit } from './audit'
import { authorizeClinical } from './patients'

function addMonths(day: string, months: number) {
  const [year, month, date] = day.split('-').map(Number)
  const target = new Date(Date.UTC(year!, month! - 1 + months, 1))
  target.setUTCDate(Math.min(date!, new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()))
  return target.toISOString().slice(0, 10)
}

function intervalDate(day: string, interval: string | null) {
  if (!interval) return day
  const weeks = /^(\d+) semanas?$/.exec(interval)
  const months = /^(\d+) mes(?:es)?$/.exec(interval)
  const years = /^(\d+) años?(?: después de la (?:tercera|segunda|primera) dosis)?$/.exec(interval)
  if (months) return addMonths(day, Number(months[1]))
  if (years) return addMonths(day, Number(years[1]) * 12)
  if (weeks) return new Date(Date.parse(`${day}T00:00:00Z`) + Number(weeks[1]) * 7 * 86400000).toISOString().slice(0, 10)
  return null
}

function releaseIdentity(row: { publisher: string, version: string, url: string }) {
  return JSON.stringify([row.publisher, row.version, row.url])
}

function isApplied(item: typeof catalogItem.$inferSelect, release: typeof catalogRelease.$inferSelect, doses: Pick<DoseRecord, 'releaseId' | 'key' | 'appliedAt'>[], releases: (typeof catalogRelease.$inferSelect)[]) {
  return doses.some(dose => dose.key === item.key && dose.releaseId !== null && releases.some(row => row.id === dose.releaseId && releaseIdentity(row) === releaseIdentity(release)))
}

function eligibleDate(item: typeof catalogItem.$inferSelect, siblings: (typeof catalogItem.$inferSelect)[], doses: Pick<DoseRecord, 'releaseId' | 'key' | 'appliedAt'>[], birth: string, releases: (typeof catalogRelease.$inferSelect)[], release: typeof catalogRelease.$inferSelect) {
  let date = addMonths(birth, Number(item.minAgeMonths))
  const bopvNumber = item.label === 'bOPV oral' && /^bopv-[123]$/.test(item.key) ? Number(item.key.slice(-1)) : null
  const doseNumber = item.doseNumber ? Number(item.doseNumber) : bopvNumber
  if (doseNumber && doseNumber > 1) {
    const previousKey = item.key.replace(/-(?:\d+|refuerzo)$/, `-${doseNumber - 1}`)
    const previous = siblings.find(row => row.key === previousKey && (row.doseNumber ? Number(row.doseNumber) === doseNumber - 1 : bopvNumber !== null && row.label === 'bOPV oral'))
    if (!previous) return null
    const prior = doses.filter(dose => dose.key === previous.key && dose.releaseId !== null && releases.some(row => row.id === dose.releaseId && releaseIdentity(row) === releaseIdentity(release))).sort((a, b) => b.appliedAt.localeCompare(a.appliedAt))[0]
    if (!prior) return null
    const earliest = intervalDate(prior.appliedAt, item.minimumInterval)
    if (!earliest) return null
    if (earliest > date) date = earliest
  }
  return date
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
    const [item] = await db.select().from(catalogItem).where(and(eq(catalogItem.releaseId, input.releaseId!), eq(catalogItem.key, input.key!)))
    const [release] = await db.select().from(catalogRelease).where(eq(catalogRelease.id, input.releaseId!))
    if (!item || !release || release.kind !== 'VACCINE' || item.status !== draftStatus) throw createError({ statusCode: 404, statusMessage: 'Vaccine not found' })
    const releases = await db.select().from(catalogRelease).where(eq(catalogRelease.kind, 'VACCINE'))
    const doses = await db.select().from(vaccineDose).where(eq(vaccineDose.patientId, patientId))
    const siblings = await db.select().from(catalogItem).where(eq(catalogItem.releaseId, release.id))
    if (isApplied(item, release, doses, releases)) throw createError({ statusCode: 409, statusMessage: 'Dose already recorded' })
    const earliest = eligibleDate(item, siblings, doses, person.birthDate, releases, release)
    if (!earliest || input.appliedAt < earliest) throw createError({ statusCode: 400, statusMessage: 'Dose before documented minimum age or interval' })
    label = item.label
    doseLabel = item.doseLabel ?? (item.doseNumber ? `Dosis ${item.doseNumber}` : null)
    version = release.version
    sourcePage = item.sourcePage
    key = input.key!
    releaseId = input.releaseId!
  }
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(vaccineDose).values({ id: randomUUID(), patientId, releaseId, key, label, doseLabel, catalogVersion: version, sourcePage, sourceStatus: draftStatus, appliedAt: input.appliedAt, external: input.external, lot: input.lot ?? null, privateNote: input.privateNote ?? null, authorId: actor.id }).returning()
    await tx.insert(auditEvent).values({ id: randomUUID(), action: 'VACCINE_DOSE', outcome: 'ALLOWED', actorId: actor.id, subjectId: patientId })
    return row as DoseRecord
  })
}

export async function listVaccines(actor: Actor, patientId: string, today = new Date()): Promise<{ pending: PendingVaccine[], applied: DoseRecord[] }> {
  await authorizeClinical(actor, 'CLINICAL_READ', patientId)
  const db = useDb()
  const [person] = await db.select({ birthDate: patient.birthDate }).from(patient).where(eq(patient.id, patientId))
  if (!person) throw createError({ statusCode: 404, statusMessage: 'Patient not found' })
  const applied = await db.select().from(vaccineDose).where(eq(vaccineDose.patientId, patientId)).orderBy(desc(vaccineDose.appliedAt)) as DoseRecord[]
  const pending: PendingVaccine[] = []
  const releases = await db.select().from(catalogRelease).where(eq(catalogRelease.kind, 'VACCINE'))
  for (const release of await currentReleases('VACCINE')) {
    const rows = await db.select().from(catalogItem).where(eq(catalogItem.releaseId, release.id)).orderBy(asc(catalogItem.minAgeMonths), asc(catalogItem.key))
    for (const item of rows) {
      const earliest = eligibleDate(item, rows, applied, person.birthDate, releases, release)
      if (item.status !== draftStatus || !earliest || today.toISOString().slice(0, 10) < earliest || isApplied(item, release, applied, releases)) continue
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
  const output: { id: string, name: string, pending: PendingVaccine[], contacts: { name: string, phone: string }[] }[] = []
  for (const person of people) {
    const { pending } = await listVaccines(actor, person.id, today)
    if (!pending.length) continue
    const contacts = await db.select({ name: user.name, phone: guardianGrant.contactPhone }).from(guardianGrant).innerJoin(user, eq(user.id, guardianGrant.guardianId)).where(and(eq(guardianGrant.patientId, person.id), eq(guardianGrant.status, 'ACTIVE')))
    output.push({ ...person, pending, contacts: contacts.filter(row => row.phone && /^09\d{8}$/.test(row.phone)).map(row => ({ name: row.name, phone: row.phone! })) })
  }
  return output
}
