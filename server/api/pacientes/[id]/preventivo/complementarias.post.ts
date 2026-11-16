import { defineEventHandler, getRouterParam, readBody } from 'h3'
import { z } from 'zod'
import { complementaryInputSchema } from '../../../../../shared/types/preventive'
import { requireCapability } from '../../../../services/access'
import { addComplementaryVaccine } from '../../../../services/vaccination'

export default defineEventHandler(async (event) => {
  const id = z.uuid().parse(getRouterParam(event, 'id'))
  const actor = await requireCapability(event, 'CLINICAL_WRITE', id)
  return addComplementaryVaccine(actor, complementaryInputSchema.parse({ ...await readBody(event), patientId: id }))
})
