import { createError, defineEventHandler, getRouterParam } from 'h3'
import { requireCapability } from '../../../services/access'
import { getPatient } from '../../../services/patients'
import { getVisits } from '../../../services/visits'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Patient ID required' })
  const actor = await requireCapability(event, 'CLINICAL_READ', id)
  const person = await getPatient(actor, id)
  const visits = await getVisits(actor, id)
  return { patient: person, visits }
})
