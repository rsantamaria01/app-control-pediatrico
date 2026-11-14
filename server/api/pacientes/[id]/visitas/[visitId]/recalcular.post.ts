import { createError, defineEventHandler, getRouterParam, readBody } from 'h3'
import { z } from 'zod'
import { requireCapability } from '../../../../../services/access'
import { recalculateVisit } from '../../../../../services/visits'

const schema = z.strictObject({ requestId: z.uuid() })

export default defineEventHandler(async (event) => {
  const patientId = getRouterParam(event, 'id')
  const visitId = getRouterParam(event, 'visitId')
  if (!patientId || !visitId) throw createError({ statusCode: 400, statusMessage: 'Patient and visit ID required' })
  const actor = await requireCapability(event, 'CLINICAL_WRITE', patientId)
  return recalculateVisit(actor, patientId, visitId, schema.parse(await readBody(event)))
})
