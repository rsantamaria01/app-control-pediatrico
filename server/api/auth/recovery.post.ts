import { defineEventHandler, getRequestIP, readBody } from 'h3'
import { z } from 'zod'
import { requestRecovery } from '../../services/recovery'
import { recoveryClientAddress } from '../../services/otp-rate-limit'

export default defineEventHandler(async (event) => {
  const body = z.object({ identity: z.string().min(3).max(254) }).parse(await readBody(event))
  const forwarded = event.node.req.headers['x-forwarded-for']
  return requestRecovery(body.identity, recoveryClientAddress(getRequestIP(event), typeof forwarded === 'string' ? forwarded : undefined, process.env.AUTH_TRUSTED_PROXY_CIDR))
})
