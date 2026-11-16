import { defineEventHandler, getRouterParam, readBody } from 'h3'
import { z } from 'zod'
import { assessmentInputSchema } from '../../../../../shared/types/preventive'
import { requireCapability } from '../../../../services/access'
import { assessMilestone } from '../../../../services/development'

export default defineEventHandler(async (event) => {
  const id = z.uuid().parse(getRouterParam(event, 'id'))
  const actor = await requireCapability(event, 'CLINICAL_WRITE', id)
  return assessMilestone(actor, id, assessmentInputSchema.parse(await readBody(event)))
})
