import { and, desc, eq, gte, inArray, lt } from 'drizzle-orm'
import { createError, defineEventHandler } from 'h3'
import { appointment, bookingRequest, guardianGrant, notificationOutbox, patient, setupToken, staffNoticeRead } from '../../db/schema'
import { localDate } from '../../services/availability'
import { resolveActor } from '../../services/access'
import { listPendingControls } from '../../services/controls-review'
import { listGrowthReview } from '../../services/growth-review'
import { listVaccinationReview } from '../../services/vaccination'
import { useDb } from '../../utils/db'

type StaffNotice = { id: string, title: string, context: string, icon: string, to: string, createdAt: string, readAt?: string }

export default defineEventHandler(async (event): Promise<StaffNotice[]> => {
  const actor = await resolveActor(event)
  if (!actor) throw createError({ statusCode: 401, statusMessage: 'Authentication required' })
  const doctor = actor.roles.includes('DOCTOR')
  const assistant = actor.roles.includes('ASSISTANT')
  const admin = actor.roles.includes('ADMIN')
  if (!doctor && !assistant && !admin) throw createError({ statusCode: 403, statusMessage: 'Access denied' })
  const db = useDb()
  const now = new Date()
  const notices: StaffNotice[] = []
  if (doctor || assistant) {
    const pending = await db.select({ id: bookingRequest.id, childName: bookingRequest.childName, createdAt: bookingRequest.createdAt }).from(bookingRequest).where(eq(bookingRequest.status, 'PENDING')).orderBy(desc(bookingRequest.createdAt)).limit(20)
    notices.push(...pending.map(row => ({ id: `booking:${row.id}`, title: 'Solicitud de reserva', context: row.childName, icon: 'i-lucide-inbox', to: '/agenda/solicitudes', createdAt: row.createdAt.toISOString() })))
    const appointments = await db.select({ id: appointment.id, name: appointment.name, startsAt: appointment.startsAt }).from(appointment).where(and(gte(appointment.startsAt, new Date(now.getTime() - 86400000)), lt(appointment.startsAt, new Date(now.getTime() + 86400000)), inArray(appointment.status, ['PENDING', 'CONFIRMED']))).orderBy(appointment.startsAt).limit(30)
    notices.push(...appointments.filter(row => localDate(row.startsAt) === localDate(now)).map(row => ({ id: `appointment:${row.id}`, title: 'Cita de hoy', context: row.name, icon: 'i-lucide-calendar-days', to: '/agenda', createdAt: row.startsAt.toISOString() })))
    if (doctor) {
      const [vaccines, growth, controls] = await Promise.all([listVaccinationReview(actor), listGrowthReview(actor), listPendingControls(actor)])
      for (const [kind, title, to, rows] of [
        ['vaccines', 'Vacunación por revisar', '/pacientes/vacunacion-por-revisar', vaccines],
        ['growth', 'Crecimiento por revisar', '/pacientes/crecimiento-por-revisar', growth],
        ['controls', 'Controles pendientes', '/pacientes/controles-pendientes', controls]
      ] as const) notices.push(...rows.slice(0, 10).map(row => ({ id: `${kind}:${row.id}`, title, context: row.name, icon: 'i-lucide-clipboard-list', to, createdAt: now.toISOString() })))
    }
    const invitations = await db.select({ id: patient.id, guardianId: guardianGrant.guardianId, name: patient.name, status: guardianGrant.status, verifiedAt: guardianGrant.verifiedAt, expiresAt: setupToken.expiresAt }).from(guardianGrant).innerJoin(patient, eq(patient.id, guardianGrant.patientId)).leftJoin(setupToken, eq(setupToken.id, guardianGrant.tokenId)).where(inArray(guardianGrant.status, ['PENDING', 'ACTIVE', 'FAILED'])).orderBy(desc(guardianGrant.verifiedAt)).limit(20)
    notices.push(...invitations.map(row => ({ id: `invitation:${row.id}:${row.guardianId}:${row.status}`, title: row.status === 'ACTIVE' ? 'Invitación activada' : row.status === 'FAILED' ? 'Invitación con entrega fallida' : row.expiresAt && row.expiresAt < now ? 'Invitación vencida' : 'Invitación pendiente de activación', context: row.name, icon: 'i-lucide-user-check', to: '/representantes/invitar', createdAt: row.verifiedAt.toISOString() })))
  }
  if (admin) {
    const failures = await db.select({ id: notificationOutbox.id, channel: notificationOutbox.channel, state: notificationOutbox.state, createdAt: notificationOutbox.createdAt }).from(notificationOutbox).where(and(inArray(notificationOutbox.channel, ['EMAIL', 'WHATSAPP']), inArray(notificationOutbox.state, ['FAILED', 'NOT_CONFIGURED']))).orderBy(desc(notificationOutbox.createdAt)).limit(20)
    notices.push(...failures.map(row => ({ id: `delivery:${row.id}`, title: row.state === 'FAILED' ? 'Entrega fallida' : 'Canal no configurado', context: row.channel === 'EMAIL' ? 'Correo electrónico' : 'WhatsApp', icon: 'i-lucide-mail-warning', to: '/admin/clinica#recordatorios', createdAt: row.createdAt.toISOString() })))
  }
  const seen = await db.select({ noticeId: staffNoticeRead.noticeId, readAt: staffNoticeRead.readAt }).from(staffNoticeRead).where(eq(staffNoticeRead.userId, actor.id))
  const read = new Map(seen.map(row => [row.noticeId, row.readAt.toISOString()]))
  return notices.toSorted((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 80).map(notice => ({ ...notice, readAt: read.get(notice.id) }))
})
