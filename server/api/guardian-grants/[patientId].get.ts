import { createError, defineEventHandler, getRouterParam } from 'h3'
import { requireCapability } from '../../services/access'
import { getGrantCandidate } from '../../services/invitations'

export default defineEventHandler(async (event) => {
  const patientId = getRouterParam(event, 'patientId')
  if (!patientId) throw createError({ statusCode: 400, statusMessage: 'Patient ID required' })
  const actor = await requireCapability(event, 'GUARDIAN_GRANT')
  return getGrantCandidate(actor, patientId)
})
