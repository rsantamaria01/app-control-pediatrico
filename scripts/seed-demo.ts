import { randomUUID } from 'node:crypto'
import { hashPassword } from 'better-auth/crypto'
import { and, eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import manifest from './who-2006-manifest.json' with { type: 'json' }
import { account, appointment, bookingRequest, patient, user, userRole, visit, whoDataset } from '../server/db/schema.ts'
import { instant, localDate } from '../server/services/availability.ts'
import { createVisit } from '../server/services/visits.ts'
import { useDb } from '../server/utils/db.ts'
import type { Actor } from '../shared/types/access.ts'
import type { MeasurementInput } from '../shared/types/measurement.ts'

const connectionString = process.env.DATABASE_URL
if (!connectionString) throw new Error('DATABASE_URL required')
const url = new URL(connectionString)
const databaseName = url.pathname.slice(1)
if (!['postgres:', 'postgresql:'].includes(url.protocol) || !/^pediatrico_design_[a-f0-9]{12}_test$/.test(databaseName)
  || url.search || url.hash || (process.env.DB_NAME && process.env.DB_NAME !== databaseName)) throw new Error('Only a disposable pediatrico_design_[12 hex]_test database is allowed')
const password = process.env.DEMO_DOCTOR_PASSWORD
if (!password || password.length < 10) throw new Error('DEMO_DOCTOR_PASSWORD (at least 10 characters) required')

const doctorId = 'b77862a5-d555-446c-853f-ce2a18715721'
const doctor: Actor = { id: doctorId, roles: ['DOCTOR'] }
const fixtures: { id: string, name: string, birthDate: string, sex: 'MALE' | 'FEMALE', visits: Omit<MeasurementInput, 'requestId'>[] }[] = [
  {
    id: 'f32790f7-1312-4118-9ba2-2ba0d89168be', name: 'Paciente Demo A', birthDate: '2024-01-01', sex: 'FEMALE',
    visits: [
      { measuredAt: '2024-07-01T15:00:00.000Z', weightKg: 7.2, lengthHeightCm: 65, position: 'RECUMBENT', headCircumferenceCm: 42, shareWithFamily: true },
      { measuredAt: '2025-01-01T15:00:00.000Z', weightKg: 9, lengthHeightCm: 75, position: 'RECUMBENT', headCircumferenceCm: 45, shareWithFamily: true },
      { measuredAt: '2026-01-02T15:00:00.000Z', weightKg: 12, lengthHeightCm: 86, position: 'STANDING', headCircumferenceCm: 48, shareWithFamily: true }
    ]
  },
  {
    id: 'c7701da1-d84e-4c50-a0e4-76b241321596', name: 'Paciente Demo B', birthDate: '2024-05-01', sex: 'MALE',
    visits: [
      { measuredAt: '2025-05-01T15:00:00.000Z', weightKg: 9.7, lengthHeightCm: 76, position: 'RECUMBENT', headCircumferenceCm: 46, shareWithFamily: true },
      { measuredAt: '2026-05-01T15:00:00.000Z', weightKg: 12.5, lengthHeightCm: 87, position: 'STANDING', headCircumferenceCm: 49, shareWithFamily: true }
    ]
  }
]
const requestIds = [
  ['7f5407a1-4325-4bbb-94a1-882840265e27', '48cf92ae-7582-4927-9126-22c507801b58', '66f1a4e5-5155-410e-8cf3-0cde83e5c4d1'],
  ['ac2855ef-d52f-45c5-96d8-6762973b7c89', 'ded081b7-c8c3-4b12-b9ea-a5ae3de668df']
]

const pool = new Pool({ connectionString })
let visitsStarted = false
try {
  const db = drizzle(pool)
  const identity = await pool.query<{ name: string }>('SELECT current_database() AS name')
  if (identity.rows[0]?.name !== databaseName) throw new Error('Connected database does not match disposable database name')
  const datasets = await db.select({
    id: whoDataset.id, publisher: whoDataset.publisher, standard: whoDataset.standard, version: whoDataset.version,
    publicationDate: whoDataset.publicationDate, retrievedAt: whoDataset.retrievedAt, sourceUrl: whoDataset.sourceUrl,
    sha256: whoDataset.sha256, indicator: whoDataset.indicator, sex: whoDataset.sex, position: whoDataset.position,
    xUnit: whoDataset.xUnit, minX: whoDataset.minX, maxX: whoDataset.maxX, rowCount: whoDataset.rowCount, sealed: whoDataset.sealed,
    actualCount: sql<number>`(SELECT count(*)::int FROM who_reference_row WHERE dataset_id = ${whoDataset.id})`
  }).from(whoDataset)
  if (datasets.length !== manifest.files.length || datasets.some((dataset) => {
    const file = manifest.files.find(entry => entry.indicator === dataset.indicator && entry.sex === dataset.sex)
    const expectedCount = dataset.indicator === 'WEIGHT_FOR_LENGTH' ? 651 : dataset.indicator === 'WEIGHT_FOR_HEIGHT' ? 551 : 1857
    const expectedPosition = dataset.indicator === 'WEIGHT_FOR_LENGTH' ? 'RECUMBENT' : dataset.indicator === 'WEIGHT_FOR_HEIGHT' ? 'STANDING' : null
    return !file || !dataset.sealed || dataset.publisher !== 'WHO' || dataset.standard !== manifest.standard
      || dataset.version !== manifest.version || dataset.publicationDate !== file.publicationDate
      || dataset.retrievedAt !== manifest.retrievedAt || dataset.sourceUrl !== file.url || dataset.sha256 !== file.sha256
      || dataset.position !== expectedPosition || dataset.xUnit !== (expectedPosition ? 'CM' : 'DAY')
      || Number(dataset.minX) !== (expectedPosition === 'RECUMBENT' ? 45 : expectedPosition === 'STANDING' ? 65 : 0)
      || Number(dataset.maxX) !== (expectedPosition === 'RECUMBENT' ? 110 : expectedPosition === 'STANDING' ? 120 : 1856)
      || dataset.rowCount !== expectedCount || dataset.actualCount !== expectedCount
  }) || datasets.reduce((total, dataset) => total + dataset.actualCount, 0) !== 17260) throw new Error('Complete sealed verified official WHO release required before demo seeding')

  const email = 'doctor.demo@example.invalid'
  const username = 'doctor_demo'
  const [existingDoctor] = await db.select().from(user).where(eq(user.id, doctorId))
  const [emailOwner] = await db.select({ id: user.id }).from(user).where(eq(user.email, email))
  const [usernameOwner] = await db.select({ id: user.id }).from(user).where(eq(user.username, username))
  if ((emailOwner?.id !== undefined && emailOwner.id !== doctorId) || (usernameOwner?.id !== undefined && usernameOwner.id !== doctorId)
    || (existingDoctor && (existingDoctor.email !== email || existingDoctor.username !== username || existingDoctor.name !== 'Doctor Demo'))) throw new Error('Demo doctor identity conflicts with existing data')
  await db.transaction(async (tx) => {
    if (!existingDoctor) await tx.insert(user).values({ id: doctorId, name: 'Doctor Demo', email, username, displayUsername: username, emailVerified: true })
    await tx.insert(userRole).values({ userId: doctorId, role: 'DOCTOR' }).onConflictDoNothing()
    const credentials = await tx.select().from(account).where(and(eq(account.userId, doctorId), eq(account.providerId, 'credential')))
    if (credentials.length > 1 || (credentials[0] && (credentials[0].accountId !== doctorId || !credentials[0].password))) throw new Error('Demo doctor credential conflicts with existing data')
    if (!credentials.length) await tx.insert(account).values({ id: randomUUID(), accountId: doctorId, providerId: 'credential', userId: doctorId, password: await hashPassword(password) })
    const demoDay = localDate(new Date())
    await tx.insert(appointment).values({
      id: '51e742c6-ad73-4d12-96e0-c78920802410', patientId: fixtures[0]!.id, name: fixtures[0]!.name,
      contact: 'doctor.demo@example.invalid', reason: 'Control registrado para la demostración', startsAt: instant(demoDay, '09:00'),
      endsAt: instant(demoDay, '09:30'), status: 'CONFIRMED', createdBy: doctorId
    }).onConflictDoNothing()
    await tx.insert(bookingRequest).values({
      id: '81e742c6-ad73-4d12-96e0-c78920802410', source: 'PUBLIC', childName: 'Paciente Demo C',
      guardianName: 'Representante Demo', email: 'representante.demo@example.invalid',
      startsAt: instant(demoDay, '10:00'), consentVersion: 'demo', status: 'PENDING'
    }).onConflictDoNothing()
    for (const fixture of fixtures) {
      const [existing] = await tx.select().from(patient).where(eq(patient.id, fixture.id))
      if (existing && (existing.name !== fixture.name || existing.birthDate !== fixture.birthDate || existing.sex !== fixture.sex || existing.createdBy !== doctorId)) throw new Error('Demo patient identity conflicts with existing data')
      if (!existing) await tx.insert(patient).values({ id: fixture.id, name: fixture.name, birthDate: fixture.birthDate, sex: fixture.sex, createdBy: doctorId })
    }
  })
  visitsStarted = true
  for (const [patientIndex, fixture] of fixtures.entries()) {
    for (const [visitIndex, measurement] of fixture.visits.entries()) {
      const requestId = requestIds[patientIndex]![visitIndex]!
      const [existing] = await db.select({ id: visit.id, patientId: visit.patientId }).from(visit).where(eq(visit.requestId, requestId))
      if (existing && existing.patientId !== fixture.id) throw new Error('Demo visit request ID conflicts with existing data')
      const result = await createVisit(doctor, fixture.id, { ...measurement, requestId })
      if (result.results.length !== 5 || result.results.some(entry => entry.status !== 'available' || entry.reference.version !== manifest.version)) throw new Error('Demo visit does not have five verified WHO results')
    }
  }
  process.stdout.write('Demo doctor, two fictional patients, one appointment and one pending request seeded with five WHO-backed visits.\n')
} finally {
  await pool.end()
  if (visitsStarted) await useDb().$client.end()
}
