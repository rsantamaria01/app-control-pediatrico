import { createHash, randomBytes } from 'node:crypto'
import { hashPassword } from 'better-auth/crypto'
import { and, eq, inArray } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import manifest from './who-2006-manifest.json' with { type: 'json' }
import { account, appointment, bookingRequest, clinicSchedule, clinicSettings, complementaryVaccine, completedCheckup, guardianGrant, inAppNotice, individualCheckup, milestoneAssessment, notificationOutbox, patient, session, user, userRole, vaccineDose, visit, visitResult, visitText, whoDataset } from '../server/db/schema.ts'
import { createVisit } from '../server/services/visits.ts'
import { useDb } from '../server/utils/db.ts'
import type { Actor } from '../shared/types/access.ts'

if (process.env.DEMO_SEED_CONFIRM !== 'preview' || process.env.NODE_ENV === 'production' || process.env.NUXT_ENV === 'production') throw new Error('Demo seed requires DEMO_SEED_CONFIRM=preview and a non-production environment')
const target = process.env.DATABASE_URL
if (!target) throw new Error('DATABASE_URL required')
const url = new URL(target)
const database = decodeURIComponent(url.pathname.slice(1))
if (!['postgres:', 'postgresql:'].includes(url.protocol) || !/^pediatrico_design_[a-f0-9]{12}_test$/.test(database) || url.search || url.hash || (process.env.DB_NAME && process.env.DB_NAME !== database)) throw new Error('Only the isolated preview demo database is allowed')
if (process.argv.slice(2).some(flag => flag !== '--reset') || process.argv.slice(2).length > 1) throw new Error('Usage: ops demo-seed [--reset]')
const reset = process.argv.includes('--reset')
const id = (kind: string, index: number) => {
  const hex = createHash('sha256').update(`control-pediatrico:demo:v1:${kind}:${index}`).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}
const legacy = [
  { id: 'f32790f7-1312-4118-9ba2-2ba0d89168be', name: 'Paciente Demo A', birthDate: '2024-01-01', sex: 'FEMALE', createdBy: 'b77862a5-d555-446c-853f-ce2a18715721' },
  { id: 'c7701da1-d84e-4c50-a0e4-76b241321596', name: 'Paciente Demo B', birthDate: '2024-05-01', sex: 'MALE', createdBy: 'b77862a5-d555-446c-853f-ce2a18715721' }
]
const children = [
  { name: 'Nube de Papel Uno', birthDate: '2026-10-22', sex: 'FEMALE', weight: 3.7, length: 52, head: 35.5 },
  { name: 'Cometa de Cartón Dos', birthDate: '2026-08-11', sex: 'MALE', weight: 6.1, length: 61, head: 40 },
  { name: 'Luna de Fieltro Tres', birthDate: '2026-02-12', sex: 'FEMALE', weight: 8.6, length: 70, head: 44 },
  { name: 'Robot de Papel Cuatro', birthDate: '2025-10-15', sex: 'MALE', weight: 10, length: 76, head: 46, gestationDays: 190, correctionUntilMonths: 36 },
  { name: 'Estrella de Cartón Cinco', birthDate: '2025-05-10', sex: 'FEMALE', weight: 9.8, length: 79, head: 47 },
  { name: 'Dragón de Tela Seis', birthDate: '2024-07-16', sex: 'MALE', weight: 13.2, length: 89, head: 49 },
  { name: 'Mariposa de Papel Siete', birthDate: '2023-08-05', sex: 'FEMALE', weight: 13.5, length: 96, head: 49 },
  { name: 'Planeta de Cartón Ocho', birthDate: '2022-06-18', sex: 'MALE', weight: 16, length: 105, head: 51 }
] as const
const staff = [
  { username: 'doctora.demo', name: 'Doctora de Demostración', role: 'DOCTOR' },
  { username: 'asistente.demo', name: 'Asistente de Demostración', role: 'ASSISTANT' },
  { username: 'familia.demo1', name: 'Familia Ficticia Uno', role: 'PATIENT' },
  { username: 'familia.demo2', name: 'Familia Ficticia Dos', role: 'PATIENT' }
] as const
const pool = new Pool({ connectionString: target })
const db = drizzle(pool)
const doctor: Actor = { id: id('user', 0), roles: ['DOCTOR'] }
const childIds = children.map((_, index) => id('patient', index))
const userIds = staff.map((_, index) => id('user', index))
const date = (offset: number, hour = 10) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10) + `T${String(hour).padStart(2, '0')}:00:00.000Z`
const localDate = (offset: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Guayaquil', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() + offset * 86400000))

async function checkIdentity() {
  const current = await pool.query('SELECT current_database() AS name')
  if (current.rows[0]?.name !== database) throw new Error('Connected database mismatch')
  const rows = await db.select().from(patient)
  for (const row of rows) {
    const index = childIds.indexOf(row.id)
    const expected = index >= 0 ? children[index] : legacy.find(entry => entry.id === row.id)
    if (!expected || row.name !== expected.name || row.birthDate !== expected.birthDate || row.sex !== expected.sex || (index >= 0 ? row.createdBy !== doctor.id : row.createdBy !== legacy.find(entry => entry.id === row.id)?.createdBy)) throw new Error('Refusing demo seed: non-demo patient present or demo identity changed')
  }
  for (const [index, entry] of staff.entries()) {
    const [existing] = await db.select().from(user).where(eq(user.id, userIds[index]!))
    const [byName] = await db.select({ id: user.id }).from(user).where(eq(user.username, entry.username))
    const [byEmail] = await db.select({ id: user.id }).from(user).where(eq(user.email, `${entry.username}@example.invalid`))
    if ((existing && (existing.name !== entry.name || existing.username !== entry.username || existing.email !== `${entry.username}@example.invalid`)) || (byName && byName.id !== userIds[index]) || (byEmail && byEmail.id !== userIds[index])) throw new Error('Demo user identity conflicts with existing account')
  }
  const legacyDoctor = await db.select().from(user).where(eq(user.id, legacy[0]!.createdBy))
  if (rows.some(row => legacy.some(entry => entry.id === row.id)) && (legacyDoctor[0]?.username !== 'doctor_demo' || legacyDoctor[0]?.email !== 'doctor.demo@example.invalid')) throw new Error('Legacy demo identity changed')
}

async function resetDemo() {
  await db.transaction(async (tx) => {
    const demoVisits = await tx.select({ id: visit.id }).from(visit).where(inArray(visit.patientId, childIds))
    await tx.delete(inAppNotice).where(inArray(inAppNotice.subjectId, [...demoVisits.map(row => row.id), ...childIds.map((_, i) => id('checkup', i))]))
    await tx.delete(inAppNotice).where(inArray(inAppNotice.outboxId, childIds.map((_, i) => id('outbox', i))))
    if (demoVisits.length) await tx.delete(notificationOutbox).where(inArray(notificationOutbox.subjectId, demoVisits.map(row => row.id)))
    await tx.delete(notificationOutbox).where(inArray(notificationOutbox.id, childIds.map((_, i) => id('outbox', i))))
    await tx.delete(bookingRequest).where(inArray(bookingRequest.id, Array.from({ length: 3 }, (_, i) => id('booking', i))))
    await tx.delete(appointment).where(inArray(appointment.id, Array.from({ length: 12 }, (_, i) => id('appointment', i))))
    await tx.delete(completedCheckup).where(inArray(completedCheckup.id, childIds.map((_, i) => id('completed', i))))
    await tx.delete(individualCheckup).where(inArray(individualCheckup.id, childIds.map((_, i) => id('checkup', i))))
    await tx.delete(milestoneAssessment).where(inArray(milestoneAssessment.id, childIds.map((_, i) => id('milestone', i))))
    await tx.delete(vaccineDose).where(inArray(vaccineDose.id, childIds.map((_, i) => id('vaccine', i))))
    await tx.delete(complementaryVaccine).where(inArray(complementaryVaccine.id, childIds.map((_, i) => id('pending-vaccine', i))))
    await tx.delete(guardianGrant).where(inArray(guardianGrant.patientId, childIds))
    const visits = await tx.select({ id: visit.id }).from(visit).where(inArray(visit.patientId, childIds))
    if (visits.length) {
      const ids = visits.map(row => row.id)
      await tx.delete(visitResult).where(inArray(visitResult.visitId, ids))
      await tx.delete(visitText).where(inArray(visitText.visitId, ids))
      await tx.delete(visit).where(inArray(visit.id, ids))
    }
    await tx.delete(patient).where(inArray(patient.id, childIds))
    await tx.delete(session).where(inArray(session.userId, userIds))
    await tx.delete(account).where(inArray(account.userId, userIds))
    await tx.delete(userRole).where(inArray(userRole.userId, userIds))
    await tx.delete(user).where(inArray(user.id, userIds))
    const [clinic] = await tx.select().from(clinicSettings).where(eq(clinicSettings.id, 'clinic'))
    if (clinic?.updatedBy === doctor.id && clinic.name === 'Clínica de Demostración Ficticia') await tx.delete(clinicSettings).where(eq(clinicSettings.id, 'clinic'))
    const [schedule] = await tx.select().from(clinicSchedule).where(eq(clinicSchedule.id, 'demo'))
    if (schedule) await tx.delete(clinicSchedule).where(eq(clinicSchedule.id, 'demo'))
  })
}

try {
  await checkIdentity()
  if (reset) {
    await resetDemo()
    process.stdout.write('Only tagged demo records removed; legacy fictional preview fixtures and WHO references retained.\n')
  } else {
    const datasets = await db.select().from(whoDataset)
    if (datasets.length !== manifest.files.length || datasets.some(row => !row.sealed || row.publisher !== 'WHO' || row.standard !== manifest.standard || row.version !== manifest.version || !manifest.files.some(file => file.indicator === row.indicator && file.sex === row.sex && file.sha256 === row.sha256 && file.url === row.sourceUrl))) throw new Error('Verified official WHO dataset required')
    const [referenceCount] = await pool.query('SELECT count(*)::int AS total FROM who_reference_row').then(result => result.rows)
    if (referenceCount?.total !== 17260) throw new Error('Complete verified WHO reference rows required')
    const credentials: { username: string, password: string }[] = []
    for (const [index, entry] of staff.entries()) {
      const [existing] = await db.select().from(user).where(eq(user.id, userIds[index]!))
      if (!existing) {
        const password = randomBytes(24).toString('base64url')
        await db.transaction(async (tx) => {
          await tx.insert(user).values({ id: userIds[index]!, name: entry.name, username: entry.username, displayUsername: entry.username, email: `${entry.username}@example.invalid`, emailVerified: true })
          await tx.insert(userRole).values({ userId: userIds[index]!, role: entry.role })
          await tx.insert(account).values({ id: id('account', index), userId: userIds[index]!, accountId: userIds[index]!, providerId: 'credential', password: await hashPassword(password) })
        })
        credentials.push({ username: entry.username, password })
      }
    }
    for (const [index, entry] of children.entries()) {
      await db.insert(patient).values({ id: childIds[index]!, name: entry.name, birthDate: entry.birthDate, sex: entry.sex, createdBy: doctor.id, gestationDays: 'gestationDays' in entry ? entry.gestationDays : null, correctionUntilMonths: 'correctionUntilMonths' in entry ? entry.correctionUntilMonths : 24 }).onConflictDoNothing()
      const birth = Date.parse(`${entry.birthDate}T12:00:00Z`)
      const now = Date.now()
      const age = Math.floor((now - birth) / 86400000)
      const count = age < 90 ? 2 : age < 365 ? 4 : 6
      for (let j = 0; j < count; j++) {
        const elapsed = Math.max(1, j === count - 1 ? age - (age > 60 && index % 2 === 0 ? 20 : 1) : Math.floor(age * (j + 1) / count))
        const measuredAt = new Date(birth + elapsed * 86400000).toISOString()
        const fraction = (j + 1) / count
        const weightKg = Number((Math.max(2.7, entry.weight * (0.65 + 0.35 * fraction)) + (index === 6 && j === count - 1 ? 5 : 0)).toFixed(2))
        const lengthHeightCm = Number((Math.max(45, entry.length - Math.min(age / 90, 20) * (1 - fraction))).toFixed(1))
        const headCircumferenceCm = Number((entry.head - Math.min(age / 180, 4) * (1 - fraction)).toFixed(1))
        const result = await createVisit(doctor, childIds[index]!, { requestId: id(`visit-${index}`, j), measuredAt, weightKg, lengthHeightCm, headCircumferenceCm, position: elapsed < 730 ? 'RECUMBENT' : 'STANDING', shareWithFamily: j !== count - 2, privateNote: `Registro ficticio de demostración ${index + 1}.${j + 1}.`, parentAdvice: `Indicación ficticia de demostración ${index + 1}.${j + 1}; no es una recomendación médica.`, ...(j === count - 1 && index % 2 === 0 && elapsed > 21 ? { nextControlAt: new Date(Date.parse(measuredAt) + 10 * 86400000).toISOString() } : {}) })
        if (!("gestationDays" in entry) && (result.results.length !== 5 || result.results.some(item => item.status !== 'available' || item.reference.version !== manifest.version))) console.warn(`WHO result partly unavailable for fictional child ${index + 1}, visit ${j + 1}: ${result.results.filter(item => item.status !== "available").map(item => item.indicator + "=" + item.status).join(",")}`)
      }
      const guardian = index < 4 ? 2 : 3
      await db.insert(guardianGrant).values({ patientId: childIds[index]!, guardianId: userIds[guardian]!, contactEmail: `${staff[guardian]!.username}@example.invalid`, relationship: 'Representante ficticio', proof: 'Vínculo ficticio para demostración', verifiedBy: doctor.id, status: index === 1 ? 'PENDING' : index === 2 ? 'UNINVITED' : 'ACTIVE' }).onConflictDoNothing()
      await db.insert(individualCheckup).values({ id: id('checkup', index), patientId: childIds[index]!, date: localDate(index % 2 ? 12 : -12), reason: 'Control ficticio individual, pendiente de revisión médica', authorId: doctor.id }).onConflictDoNothing()
      if (index === 1) await db.insert(completedCheckup).values({ id: id('completed', index), patientId: childIds[index]!, individualId: id('checkup', index), completedAt: localDate(-3), authorId: doctor.id }).onConflictDoNothing()
      await db.insert(milestoneAssessment).values({ id: id('milestone', index), patientId: childIds[index]!, label: 'Observación ficticia de desarrollo', domain: 'Demostración', outcome: index % 3 ? 'ACHIEVED' : 'NOT_ASSESSED', authorId: doctor.id }).onConflictDoNothing()
      await db.insert(vaccineDose).values({ id: id('vaccine', index), patientId: childIds[index]!, key: `demo-dose-${index}`, label: 'Dosis ficticia registrada (no es un esquema de vacunación)', catalogVersion: 'demo', sourcePage: 'Dato ficticio', sourceStatus: 'DRAFT_PENDING_PEDIATRICIAN_REVIEW', appliedAt: localDate(-20), external: false, authorId: doctor.id }).onConflictDoNothing()
      await db.insert(complementaryVaccine).values({ id: id('pending-vaccine', index), patientId: childIds[index]!, authorId: doctor.id, label: 'Vacuna ficticia por revisar', doseLabel: 'Dato de demostración', source: 'Ficción; sin recomendación clínica' }).onConflictDoNothing()
    }
    for (let i = 0; i < 10; i++) {
      const startsAt = new Date(date(i < 4 ? 0 : i - 3, 12 + i % 4))
      await db.insert(appointment).values({ id: id('appointment', i), patientId: childIds[i % 8]!, name: children[i % 8]!.name, contact: 'Contacto ficticio', reason: 'Consulta de demostración', startsAt, endsAt: new Date(startsAt.getTime() + 30 * 60000), status: (['CONFIRMED', 'PENDING', 'ATTENDED', 'CANCELLED'] as const)[i % 4]!, createdBy: doctor.id }).onConflictDoNothing()
    }
    for (let i = 0; i < 3; i++) await db.insert(bookingRequest).values({ id: id('booking', i), source: 'PUBLIC', childName: `Solicitud Ficticia ${i + 1}`, guardianName: 'Contacto Ficticio', email: `solicitud${i + 1}@example.invalid`, startsAt: new Date(date(i + 3, 16)), status: 'PENDING', consentVersion: 'demo-only' }).onConflictDoNothing()
    for (const i of [0, 2]) {
      const outboxId = id('outbox', i)
      await db.insert(notificationOutbox).values({ id: outboxId, eventKind: 'CHECKUP_DUE', subjectId: id('checkup', i), channel: 'IN_APP', recipientKey: userIds[2]!, recipientUserId: userIds[2]!, state: 'SENT', attempts: 1, deliveredAt: new Date() }).onConflictDoNothing()
      const [ob] = await db.select({ id: notificationOutbox.id }).from(notificationOutbox).where(and(eq(notificationOutbox.subjectId, id('checkup', i)), eq(notificationOutbox.eventKind, 'CHECKUP_DUE'), eq(notificationOutbox.channel, 'IN_APP'))).limit(1)
      if (!ob) continue
      await db.insert(inAppNotice).values({ id: id('notice', i), outboxId: ob.id, userId: userIds[2]!, eventKind: 'CHECKUP_DUE', subjectId: id('checkup', i) }).onConflictDoNothing()
    }
    await db.insert(clinicSchedule).values({ id: 'demo', durationMinutes: 30 }).onConflictDoNothing()
    await db.insert(clinicSettings).values({ id: 'clinic', name: 'Clínica de Demostración Ficticia', contactEmail: 'clinica.demo@example.invalid', primary: 'brand', updatedBy: doctor.id }).onConflictDoNothing()
    process.stdout.write('Fictional preview data seeded; WHO results computed from verified references.\n')
    if (credentials.length) process.stdout.write(`New demo credentials (shown once):\n${credentials.map(item => `${item.username}: ${item.password}`).join('\n')}\n`)
    else process.stdout.write('Demo accounts already exist; passwords were not changed or reprinted.\n')
  }
} finally {
  await pool.end()
  const client = (useDb() as unknown as { $client?: { end?: () => Promise<void> } }).$client
  if (client?.end) await client.end()
}
