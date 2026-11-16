import { defineEventHandler, readBody, setHeader } from 'h3'
import { parentBookingSchema } from '../../../shared/types/booking'
import { requireCapability } from '../../services/access'
import { submitParentBooking } from '../../services/booking'

export default defineEventHandler(async (event) => {
  const actor = await requireCapability(event, 'PORTAL_READ')
  setHeader(event, 'Cache-Control', 'private, no-store')
  return submitParentBooking(actor, parentBookingSchema.parse(await readBody(event)))
})
