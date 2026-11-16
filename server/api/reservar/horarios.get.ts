import { createError, defineEventHandler, getQuery } from 'h3'
import { dateRangeSchema } from '../../../shared/types/scheduling'
import { availableSlots } from '../../services/availability'

export default defineEventHandler(async (event) => {
  const { from, to } = getQuery(event)
  const range = dateRangeSchema.parse({ from, to })
  if (range.from !== range.to) throw createError({ statusCode: 400, statusMessage: 'Seleccione un día' })
  return (await availableSlots(range)).filter(slot => slot.free && new Date(`${slot.date}T${slot.time}:00-05:00`) >= new Date())
})
