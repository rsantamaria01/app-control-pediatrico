import { defineEventHandler, getRequestIP, readBody } from 'h3'
import { bookingContactSchema } from '../../../shared/types/booking'
import { issueBookingCode } from '../../services/booking'
import { recoveryClientAddress } from '../../services/otp-rate-limit'

export default defineEventHandler(async (event) => {
  const { email } = bookingContactSchema.parse(await readBody(event))
  const forwarded = event.node.req.headers['x-forwarded-for']
  return issueBookingCode(email, recoveryClientAddress(getRequestIP(event), typeof forwarded === 'string' ? forwarded : undefined, process.env.AUTH_TRUSTED_PROXY_CIDR))
})
