import nodemailer from 'nodemailer'
import { createHash } from 'node:crypto'
import type { DomainEvent } from '../../shared/types/notification'
import { eq } from 'drizzle-orm'
import { emailHealth } from '../db/schema'
import { useDb } from '../utils/db'
import { resolveSmtpTransport } from './smtp-settings'

function healthId(config: { host: string, port: number, security: string, username: string, password: string, fromAddress: string }) {
  return createHash('sha256').update(JSON.stringify([config.host, config.port, config.security, config.username, config.password, config.fromAddress])).digest('hex')
}

async function setHealth(state: 'CONFIGURED' | 'FAILING', id: string) {
  await useDb().insert(emailHealth).values({ id, state, updatedAt: new Date() })
    .onConflictDoUpdate({ target: emailHealth.id, set: { state, updatedAt: new Date() } })
}

export async function emailProviderHealth(): Promise<'NOT_CONFIGURED' | 'FAILING' | 'CONFIGURED'> {
  try {
    const config = await resolveSmtpTransport()
    if (!config) return 'NOT_CONFIGURED'
    const [record] = await useDb().select({ state: emailHealth.state }).from(emailHealth).where(eq(emailHealth.id, healthId(config)))
    return record?.state === 'FAILING' ? 'FAILING' : 'CONFIGURED'
  } catch {
    return 'NOT_CONFIGURED'
  }
}

export async function markEmailFailure() {
  try {
    const config = await resolveSmtpTransport()
    if (config) await setHealth('FAILING', healthId(config))
  } catch {
    return
  }
}

export async function emailTransportAvailable() {
  try {
    return Boolean(await resolveSmtpTransport())
  } catch {
    return false
  }
}

export async function sendMail(email: string, subject: string, text: string): Promise<void> {
  let config: Awaited<ReturnType<typeof resolveSmtpTransport>>
  try {
    config = await resolveSmtpTransport()
  } catch {
    throw new Error('Email transport unavailable')
  }
  if (!config) throw new Error('Email transport unavailable')
  if (config.username && config.security === 'NONE') throw new Error('Email transport unavailable')
  const transport = nodemailer.createTransport({
    host: config.host, port: config.port, secure: config.security === 'TLS',
    requireTLS: config.security === 'STARTTLS', ignoreTLS: config.security === 'NONE',
    connectionTimeout: 5000, greetingTimeout: 5000, socketTimeout: 10000,
    auth: config.username && config.password ? { user: config.username, pass: config.password } : undefined
  })
  try {
    const result = await transport.sendMail({ from: config.fromName ? { name: config.fromName, address: config.fromAddress } : config.fromAddress, to: email, subject, text })
    if (!result.accepted.includes(email)) throw new Error('Email delivery failed')
    await setHealth('CONFIGURED', healthId(config))
  } catch (error) {
    await setHealth('FAILING', healthId(config))
    const code = (error as { responseCode?: unknown })?.responseCode
    const failure = new Error(typeof code === 'number' && code >= 400 && code <= 599 ? `Email delivery failed (SMTP ${code})` : 'Email delivery failed')
    Object.defineProperty(failure, 'cause', { value: new Error('SMTP provider failure') })
    throw failure
  }
}

export async function sendNotificationEmail(address: string, event: DomainEvent): Promise<void> {
  const subjects: Record<DomainEvent['kind'], string> = {
    BOOKING_PENDING: 'Solicitud de cita recibida', BOOKING_APPROVED: 'Cita aprobada',
    BOOKING_DECLINED: 'Solicitud de cita rechazada', BOOKING_RESCHEDULED: 'Cita reprogramada',
    BOOKING_CANCELLED: 'Cita cancelada', VISIT_RECORDED: 'Nueva consulta compartida', CHECKUP_DUE: 'Recordatorio de control indicado por su médico'
  }
  const subject = subjects[event.kind]
  await sendMail(address, `${subject} · Control Pediátrico`, `${subject}. Consulte el portal de Control Pediátrico para más información.`)
}

export async function sendBookingCode(email: string, code: string) {
  await sendMail(email, 'Verificación de solicitud · Control Pediátrico', `Código para solicitar una cita: ${code}. Caduca en 10 minutos. No crea acceso al portal.`)
}

export async function sendLink(email: string, link: string) {
  await sendMail(email, 'Acceso · Control Pediátrico', `Use este enlace para configurar o recuperar su acceso: ${link}`)
}
