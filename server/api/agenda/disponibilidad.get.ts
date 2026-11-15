import { defineEventHandler, getQuery } from 'h3'
import { dateRangeSchema } from '../../../shared/types/scheduling'
import { requireCapability } from '../../services/access'
import { getAvailability } from '../../services/availability'

export default defineEventHandler(async (event) => {
  const actor = await requireCapability(event, 'SCHEDULE')
  const { from, to } = getQuery(event)
  return getAvailability(actor, dateRangeSchema.parse({ from, to }))
})
