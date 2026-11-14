import { createError, defineEventHandler, getRouterParam, readBody } from 'h3'
import { z } from 'zod'
import { requireCapability } from '../../../../../services/access'
import { setVisitSharing } from '../../../../../services/invitations'

export default defineEventHandler(async (event) => {
  const patientId = getRouterParam(event, 'id')
  const visitId = getRouterParam(event, 'visitId')
  if (!patientId || !visitId) throw createError({ statusCode: 400, statusMessage: 'Patient and visit ID required' })
  const actor = await requireCapability(event, 'CLINICAL_WRITE', patientId)
  const { shared } = z.strictObject({ shared: z.boolean() }).parse(await readBody(event))
  return setVisitSharing(actor, patientId, visitId, shared)
})
