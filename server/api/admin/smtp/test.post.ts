import { createError, defineEventHandler, getRequestIP, readBody } from 'h3'
import { smtpTestSchema } from '../../../../shared/types/smtp'
import { requireCapability } from '../../../services/access'
import { recoveryClientAddress } from '../../../services/otp-rate-limit'
import { testSmtpConnection } from '../../../services/smtp-test'

export default defineEventHandler(async (event) => {
  const actor = await requireCapability(event, 'ADMINISTER')
  const input = smtpTestSchema.safeParse(await readBody(event))
  if (!input.success) throw createError({ statusCode: 400, statusMessage: 'Correo de destino inválido' })
  const forwarded = event.node.req.headers['x-forwarded-for']
  const address = recoveryClientAddress(getRequestIP(event), typeof forwarded === 'string' ? forwarded : undefined, process.env.AUTH_TRUSTED_PROXY_CIDR)
  return testSmtpConnection(actor, input.data.email, address)
})
