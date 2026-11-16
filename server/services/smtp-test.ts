import { createError } from 'nuxt/server'
import type { Actor } from '../../shared/types/access'
import { recordAudit } from './audit'
import { sendMail } from './email'
import { consumeAccessLimit } from './otp-rate-limit'

interface SmtpTestDependencies {
  limit?: typeof consumeAccessLimit
  send?: typeof sendMail
}

export async function testSmtpConnection(actor: Actor, email: string, address: string, dependencies: SmtpTestDependencies = {}): Promise<{ sent: true }> {
  if (!actor?.id || !actor.roles?.includes('ADMIN')) throw createError({ statusCode: 403, statusMessage: 'Access denied' })
  let allowed: boolean
  try {
    allowed = await (dependencies.limit ?? consumeAccessLimit)(email, address, 'smtp-test')
  } catch {
    throw createError({ statusCode: 503, statusMessage: 'Prueba de correo no disponible' })
  }
  if (!allowed) throw createError({ statusCode: 429, statusMessage: 'Inténtelo más tarde' })
  try {
    await (dependencies.send ?? sendMail)(email, 'Correo de prueba · Control Pediátrico', 'Este es un correo de prueba de la configuración de la clínica.')
  } catch (error) {
    await recordAudit('SMTP_TEST_SEND', 'DENIED', actor.id)
    const code = /^Email delivery failed \(SMTP ([45]\d\d)\)$/.exec(error instanceof Error ? error.message : '')?.[1]
    throw createError({ statusCode: 502, statusMessage: code ? `El servidor SMTP rechazó el correo (${code})` : 'No se pudo enviar el correo de prueba' })
  }
  await recordAudit('SMTP_TEST_SEND', 'ALLOWED', actor.id)
  return { sent: true }
}
