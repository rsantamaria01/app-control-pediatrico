import { defineEventHandler, getRouterParam, readBody } from 'h3'
import { bookingDecisionSchema } from '../../../../shared/types/booking'
import { requireCapability } from '../../../services/access'
import { decideBookingRequest } from '../../../services/booking'

export default defineEventHandler(async (event) => {
  const actor = await requireCapability(event, 'SCHEDULE')
  const { decision } = bookingDecisionSchema.parse(await readBody(event))
  return decideBookingRequest(actor, getRouterParam(event, 'id')!, decision)
})
