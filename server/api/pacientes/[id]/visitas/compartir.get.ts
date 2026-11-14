import { createError, defineEventHandler, getRouterParam } from 'h3'
import { requireCapability } from '../../../../services/access'
import { listVisitSharing } from '../../../../services/invitations'

export default defineEventHandler(async (event) => {
  const patientId = getRouterParam(event, 'id')
  if (!patientId) throw createError({ statusCode: 400, statusMessage: 'Patient ID required' })
  const actor = await requireCapability(event, 'CLINICAL_READ', patientId)
  return listVisitSharing(actor, patientId)
})
