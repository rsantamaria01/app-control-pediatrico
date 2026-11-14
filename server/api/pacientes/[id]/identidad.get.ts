import { createError, defineEventHandler, getRouterParam } from 'h3'
import { requireCapability } from '../../../services/access'
import { getPatient } from '../../../services/patients'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Patient ID required' })
  const actor = await requireCapability(event, 'CLINICAL_READ', id)
  return getPatient(actor, id)
})
