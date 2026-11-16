import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto'
import { and, eq, gt, isNull, sql } from 'drizzle-orm'
import { createError } from 'nuxt/server'
import type { Actor } from '../../shared/types/access'
import { bookingContactSchema, bookingCodeSchema, parentBookingSchema, publicBookingSchema, type BookingDecision, type BookingRequestView, type ParentAppointment, type PendingRequest, type VerifiedBookingInput } from '../../shared/types/booking'
import { appointment, auditEvent, bookingNotice, bookingProof, bookingRequest, guardianGrant, patient, user } from '../db/schema'
import { useDb } from '../utils/db'
import { availableSlots, instant, localDate, localTime, requireSchedule, zone } from './availability'
import { sendBookingCode } from './email'
import { consumeAccessLimit } from './otp-rate-limit'

const digest = (value: string) => createHash('sha256').update(value).digest('hex')
const unavailable = () => createError({ statusCode: 403, statusMessage: 'Verificación no válida' })
const conflict = () => createError({ statusCode: 409, statusMessage: 'Solicitud duplicada o horario no disponible' })
const notice = (id: string, status: string) => ({ id: randomUUID(), requestId: id, status })
const audit = (actor: Actor, id: string, action: string) => ({ id: randomUUID(), actorId: actor.id, subjectId: id, action, outcome: 'ALLOWED' })
const pending = (id: string, startsAt: Date): PendingRequest => ({ id, status: 'PENDING', date: localDate(startsAt), time: localTime(startsAt) })
const clientLimit = async (email: string, address: string, action: string) => {
  try {
    if (await consumeAccessLimit(email, address, action)) return
  } catch {
    throw createError({ statusCode: 503, statusMessage: 'Verificación no disponible' })
  }
  throw createError({ statusCode: 429, statusMessage: 'Inténtelo más tarde' })
}

export async function issueBookingCode(address: string, peer: string, deliver: (email: string, code: string) => Promise<void> = sendBookingCode) {
  const { email } = bookingContactSchema.parse({ email: address })
  await clientLimit(email, peer, 'booking-code')
  const code = String(randomInt(100000, 1000000))
  const id = randomUUID()
  const db = useDb()
  await db.insert(bookingProof).values({ id, email, digest: digest(code), kind: 'CODE', expiresAt: new Date(Date.now() + 600000) })
  try {
    await deliver(email, code)
  } catch {
    await db.update(bookingProof).set({ usedAt: new Date() }).where(eq(bookingProof.id, id))
    throw createError({ statusCode: 503, statusMessage: 'Verificación no disponible' })
  }
  await db.update(bookingProof).set({ usedAt: new Date() }).where(and(eq(bookingProof.email, email), eq(bookingProof.kind, 'CODE'), isNull(bookingProof.usedAt), sql`${bookingProof.id} <> ${id}`))
  return { message: 'Si el correo está disponible, recibirá un código de verificación.' }
}

export async function verifyBookingContact(address: string, code: string, peer: string) {
  const values = bookingCodeSchema.parse({ email: address, code })
  const email = values.email.trim().toLowerCase()
  await clientLimit(email, peer, 'booking-verify')
  const db = useDb()
  const token = randomBytes(32).toString('base64url')
  const verified = await db.transaction(async (tx) => {
    const [entry] = await tx.select().from(bookingProof).where(and(eq(bookingProof.email, email), eq(bookingProof.kind, 'CODE'), isNull(bookingProof.usedAt), gt(bookingProof.expiresAt, new Date()))).orderBy(sql`${bookingProof.expiresAt} DESC`).limit(1).for('update')
    if (!entry || entry.attempts >= 5) throw unavailable()
    await tx.update(bookingProof).set({ attempts: entry.attempts + 1, ...(digest(code) === entry.digest ? { usedAt: new Date() } : {}) }).where(eq(bookingProof.id, entry.id))
    if (digest(code) !== entry.digest) return false
    await tx.update(bookingProof).set({ usedAt: new Date() }).where(and(eq(bookingProof.email, email), eq(bookingProof.kind, 'TOKEN'), isNull(bookingProof.usedAt)))
    await tx.insert(bookingProof).values({ id: randomUUID(), email, digest: digest(token), kind: 'TOKEN', expiresAt: new Date(Date.now() + 600000) })
    return true
  })
  if (!verified) throw unavailable()
  return token
}

export async function submitBookingRequest(input: VerifiedBookingInput): Promise<PendingRequest> {
  const values = publicBookingSchema.parse(input)
  const startsAt = instant(values.date, values.time)
  return useDb().transaction(async (tx) => {
    await tx.execute('SELECT pg_advisory_xact_lock(1130011)')
    const [proof] = await tx.update(bookingProof).set({ usedAt: new Date() }).where(and(eq(bookingProof.email, values.email), eq(bookingProof.kind, 'TOKEN'), eq(bookingProof.digest, digest(values.verificationToken)), isNull(bookingProof.usedAt), gt(bookingProof.expiresAt, new Date()))).returning()
    if (!proof) throw unavailable()
    if (startsAt < new Date() || !(await availableSlots({ from: values.date, to: values.date }, undefined, tx)).some(slot => slot.time === values.time && slot.free)) throw conflict()
    const duplicate = await tx.select({ id: bookingRequest.id }).from(bookingRequest).where(and(eq(bookingRequest.email, values.email), eq(bookingRequest.childName, values.childName), eq(bookingRequest.birthDate, values.birthDate), eq(bookingRequest.status, 'PENDING'))).limit(1)
    if (duplicate.length) throw conflict()
    const id = randomUUID()
    await tx.insert(bookingRequest).values({ id, source: 'PUBLIC', childName: values.childName, birthDate: values.birthDate, sex: values.sex, guardianName: values.guardianName, relationship: values.relationship, email: values.email, phone: values.phone, startsAt, consentVersion: values.consentVersion })
    await tx.insert(bookingNotice).values(notice(id, 'PENDING'))
    return pending(id, startsAt)
  })
}

export async function submitParentBooking(actor: Actor, input: unknown): Promise<PendingRequest> {
  if (actor.roles.length !== 1 || !actor.roles.includes('PATIENT')) throw createError({ statusCode: 403, statusMessage: 'Access denied' })
  const values = parentBookingSchema.parse(input)
  return useDb().transaction(async (tx) => {
    await tx.execute('SELECT pg_advisory_xact_lock(1130011)')
    const [owned] = await tx.select({ name: patient.name, email: user.email, guardianName: user.name }).from(guardianGrant).innerJoin(patient, eq(patient.id, guardianGrant.patientId)).innerJoin(user, eq(user.id, guardianGrant.guardianId)).where(and(eq(guardianGrant.patientId, values.patientId), eq(guardianGrant.guardianId, actor.id), eq(guardianGrant.status, 'ACTIVE')))
    if (!owned) throw createError({ statusCode: 404, statusMessage: 'Not found' })
    const startsAt = instant(values.date, values.time)
    if (startsAt < new Date() || !(await availableSlots({ from: values.date, to: values.date }, undefined, tx)).some(slot => slot.time === values.time && slot.free)) throw conflict()
    const duplicate = await tx.select({ id: bookingRequest.id }).from(bookingRequest).where(and(eq(bookingRequest.patientId, values.patientId), eq(bookingRequest.status, 'PENDING'))).limit(1)
    if (duplicate.length) throw conflict()
    const id = randomUUID()
    await tx.insert(bookingRequest).values({ id, source: 'PARENT', patientId: values.patientId, guardianId: actor.id, childName: owned.name, guardianName: owned.guardianName, email: owned.email, startsAt, consentVersion: values.consentVersion })
    await tx.insert(bookingNotice).values(notice(id, 'PENDING'))
    return pending(id, startsAt)
  })
}

export async function listBookingRequests(actor: Actor): Promise<BookingRequestView[]> {
  await requireSchedule(actor)
  const rows = await useDb().select().from(bookingRequest).where(eq(bookingRequest.status, 'PENDING')).orderBy(bookingRequest.startsAt)
  return rows.map(row => ({ ...pending(row.id, row.startsAt), childName: row.childName, guardianName: row.guardianName, contact: row.email, source: row.source as 'PUBLIC' | 'PARENT' }))
}

export async function pendingBookingCount(actor: Actor): Promise<number> {
  await requireSchedule(actor)
  const [row] = await useDb().select({ count: sql<number>`count(*)::integer` }).from(bookingRequest).where(eq(bookingRequest.status, 'PENDING'))
  return row?.count ?? 0
}

export async function decideBookingRequest(actor: Actor, requestId: string, decision: 'APPROVE' | 'DECLINE'): Promise<BookingDecision> {
  await requireSchedule(actor)
  if (!['APPROVE', 'DECLINE'].includes(decision)) throw createError({ statusCode: 400, statusMessage: 'Invalid decision' })
  return useDb().transaction(async (tx) => {
    await tx.execute('SELECT pg_advisory_xact_lock(1130011)')
    const [row] = await tx.select().from(bookingRequest).where(eq(bookingRequest.id, requestId)).for('update')
    if (!row || row.status !== 'PENDING') throw conflict()
    if (row.source === 'PARENT') {
      const [active] = await tx.select({ patientId: guardianGrant.patientId }).from(guardianGrant).where(and(eq(guardianGrant.patientId, row.patientId!), eq(guardianGrant.guardianId, row.guardianId!), eq(guardianGrant.status, 'ACTIVE')))
      if (!active) throw conflict()
    }
    let appointmentId: string | undefined
    if (decision === 'APPROVE') {
      const date = localDate(row.startsAt)
      const time = localTime(row.startsAt)
      const slot = (await availableSlots({ from: date, to: date }, undefined, tx)).find(item => item.time === time && item.free)
      if (!slot || row.startsAt < new Date()) throw conflict()
      appointmentId = randomUUID()
      await tx.insert(appointment).values({ id: appointmentId, patientId: row.patientId, name: row.childName, contact: row.email, reason: '', startsAt: row.startsAt, endsAt: new Date(row.startsAt.getTime() + slot.durationMinutes * 60000), timeZone: zone, status: 'CONFIRMED', createdBy: actor.id })
    }
    const status = decision === 'APPROVE' ? 'APPROVED' : 'DECLINED'
    await tx.update(bookingRequest).set({ status, appointmentId, decidedBy: actor.id, decidedAt: new Date() }).where(eq(bookingRequest.id, requestId))
    await tx.insert(auditEvent).values(audit(actor, requestId, `BOOKING_${decision}`))
    await tx.insert(bookingNotice).values(notice(requestId, status))
    return { requestId, status, ...(appointmentId ? { appointmentId } : {}) }
  })
}

export async function listParentAppointments(actor: Actor): Promise<ParentAppointment[]> {
  if (actor.roles.length !== 1 || !actor.roles.includes('PATIENT')) throw createError({ statusCode: 403, statusMessage: 'Access denied' })
  const db = useDb()
  const rows = await db.select({ id: bookingRequest.id, name: bookingRequest.childName, startsAt: bookingRequest.startsAt, status: bookingRequest.status, appointmentId: bookingRequest.appointmentId, currentStart: appointment.startsAt, currentStatus: appointment.status }).from(bookingRequest).innerJoin(guardianGrant, and(eq(guardianGrant.patientId, bookingRequest.patientId), eq(guardianGrant.guardianId, actor.id), eq(guardianGrant.status, 'ACTIVE'))).leftJoin(appointment, eq(appointment.id, bookingRequest.appointmentId)).where(and(eq(bookingRequest.guardianId, actor.id), eq(bookingRequest.source, 'PARENT'))).orderBy(sql`${bookingRequest.createdAt} DESC`)
  const scheduled = await db.select({ id: appointment.id, name: appointment.name, startsAt: appointment.startsAt, status: appointment.status }).from(appointment).innerJoin(guardianGrant, and(eq(guardianGrant.patientId, appointment.patientId), eq(guardianGrant.guardianId, actor.id), eq(guardianGrant.status, 'ACTIVE'))).where(sql`NOT EXISTS (SELECT 1 FROM booking_request WHERE booking_request.appointment_id = ${appointment.id})`)
  return [...rows.map((row) => {
    const date = row.currentStart ?? row.startsAt
    const status = row.currentStatus === 'CANCELLED' ? 'CANCELLED' : row.currentStatus === 'ATTENDED' ? 'ATTENDED' : row.currentStart && row.currentStart.getTime() !== row.startsAt.getTime() ? 'RESCHEDULED' : row.status
    return { id: row.id, name: row.name, date: localDate(date), time: localTime(date), status: status as ParentAppointment['status'] }
  }), ...scheduled.map(row => ({ id: row.id, name: row.name, date: localDate(row.startsAt), time: localTime(row.startsAt), status: (row.status === 'CONFIRMED' ? 'APPROVED' : row.status === 'PENDING' ? 'PENDING' : row.status === 'ATTENDED' ? 'ATTENDED' : 'CANCELLED') as ParentAppointment['status'] }))].sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`))
}

export async function recordBookingAppointmentChange(tx: Parameters<Parameters<ReturnType<typeof useDb>['transaction']>[0]>[0], appointmentId: string, status: 'RESCHEDULED' | 'CANCELLED') {
  const [row] = await tx.select({ id: bookingRequest.id }).from(bookingRequest).where(eq(bookingRequest.appointmentId, appointmentId))
  if (row) await tx.insert(bookingNotice).values(notice(row.id, status))
}
