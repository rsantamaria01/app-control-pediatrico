import { defineEventHandler, getRequestIP, readBody } from 'h3'
import { bookingCodeSchema } from '../../../shared/types/booking'
import { verifyBookingContact } from '../../services/booking'
import { recoveryClientAddress } from '../../services/otp-rate-limit'

export default defineEventHandler(async (event) => {
  const { email, code } = bookingCodeSchema.parse(await readBody(event))
  const forwarded = event.node.req.headers['x-forwarded-for']
  return { verificationToken: await verifyBookingContact(email, code, recoveryClientAddress(getRequestIP(event), typeof forwarded === 'string' ? forwarded : undefined, process.env.AUTH_TRUSTED_PROXY_CIDR)) }
})
