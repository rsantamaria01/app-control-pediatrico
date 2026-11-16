import { defineEventHandler, getRouterParam, readBody } from 'h3'
import { z } from 'zod'
import { individualCheckupSchema } from '../../../../../shared/types/preventive'
import { requireCapability } from '../../../../services/access'
import { setIndividualCheckup } from '../../../../services/checkups'

export default defineEventHandler(async (event) => {
  const id = z.uuid().parse(getRouterParam(event, 'id'))
  const actor = await requireCapability(event, 'CLINICAL_WRITE', id)
  return setIndividualCheckup(actor, id, individualCheckupSchema.parse(await readBody(event)))
})
