import { defineEventHandler, getQuery } from 'h3'
import { dateRangeSchema } from '../../../shared/types/scheduling'
import { requireCapability } from '../../services/access'
import { listAppointments } from '../../services/appointments'

export default defineEventHandler(async (event) => {
  const actor = await requireCapability(event, 'SCHEDULE')
  const { from, to } = getQuery(event)
  return listAppointments(actor, dateRangeSchema.parse({ from, to }))
})
