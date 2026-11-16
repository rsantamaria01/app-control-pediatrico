import { createError, defineEventHandler, getRequestIP, readBody } from 'h3'
import { publicBookingSchema } from '../../../shared/types/booking'
import { submitBookingRequest } from '../../services/booking'
import { consumeAccessLimit, recoveryClientAddress } from '../../services/otp-rate-limit'

export default defineEventHandler(async (event) => {
  const input = publicBookingSchema.parse(await readBody(event))
  const forwarded = event.node.req.headers['x-forwarded-for']
  const address = recoveryClientAddress(getRequestIP(event), typeof forwarded === 'string' ? forwarded : undefined, process.env.AUTH_TRUSTED_PROXY_CIDR)
  if (!await consumeAccessLimit(input.email, address, 'booking-submit')) throw createError({ statusCode: 429, statusMessage: 'Inténtelo más tarde' })
  return submitBookingRequest(input)
})
