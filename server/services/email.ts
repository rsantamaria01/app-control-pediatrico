import nodemailer from 'nodemailer'
import { emailHealth } from '../db/schema'
import { useDb } from '../utils/db'

async function setHealth(state: 'CONFIGURED' | 'FAILING') {
  await useDb().insert(emailHealth).values({ id: 'smtp', state, updatedAt: new Date() })
    .onConflictDoUpdate({ target: emailHealth.id, set: { state, updatedAt: new Date() } })
}

export async function emailProviderHealth(): Promise<'NOT_CONFIGURED' | 'FAILING' | 'CONFIGURED'> {
  if (!emailTransportAvailable()) return 'NOT_CONFIGURED'
  const [record] = await useDb().select({ state: emailHealth.state }).from(emailHealth).limit(1)
  return record?.state === 'FAILING' ? 'FAILING' : 'CONFIGURED'
}

export async function markEmailFailure() {
  await setHealth('FAILING')
}

export function emailTransportAvailable() {
  const host = process.env.SMTP_HOST
  const from = process.env.SMTP_FROM
  const port = Number(process.env.SMTP_PORT)
  return Boolean(host && from && Number.isInteger(port) && port > 0 && port <= 65535 && Boolean(process.env.SMTP_USER) === Boolean(process.env.SMTP_PASS) && (process.env.SMTP_SECURE === undefined || ['true', 'false'].includes(process.env.SMTP_SECURE)))
}

async function sendMail(email: string, subject: string, text: string) {
  if (!emailTransportAvailable()) throw new Error('Email transport unavailable')
  const host = process.env.SMTP_HOST!
  const from = process.env.SMTP_FROM!
  const port = Number(process.env.SMTP_PORT)
  const username = process.env.SMTP_USER
  const password = process.env.SMTP_PASS
  const transport = nodemailer.createTransport({ host, port, secure: process.env.SMTP_SECURE === 'true', requireTLS: process.env.SMTP_SECURE !== 'false' && port !== 465, connectionTimeout: 5000, greetingTimeout: 5000, socketTimeout: 10000, auth: username && password ? { user: username, pass: password } : undefined })
  await transport.sendMail({ from, to: email, subject, text })
  await setHealth('CONFIGURED')
}

export async function sendLink(email: string, link: string) {
  await sendMail(email, 'Acceso · Control Pediátrico', `Use este enlace para configurar o recuperar su acceso: ${link}`)
}
