import { createError, defineEventHandler, getRouterParam } from 'h3'
import { requireCapability } from '../../../services/access'
import { getDoctorGrowth } from '../../../services/growth-charts'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Patient ID required' })
  const actor = await requireCapability(event, 'CLINICAL_READ', id)
  return getDoctorGrowth(actor, id)
})
