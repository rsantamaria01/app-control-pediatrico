import { createError, defineEventHandler, getRouterParam, readBody } from 'h3'
import { visitSchema } from '../../../../../shared/types/measurement'
import { requireCapability } from '../../../../services/access'
import { createVisit } from '../../../../services/visits'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Patient ID required' })
  const actor = await requireCapability(event, 'CLINICAL_WRITE', id)
  return createVisit(actor, id, visitSchema.parse(await readBody(event)))
})
