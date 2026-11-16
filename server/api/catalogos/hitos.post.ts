import { defineEventHandler, readBody } from 'h3'
import { doctorMilestoneSchema } from '../../../shared/types/catalog'
import { requireCapability } from '../../services/access'
import { addDoctorMilestone } from '../../services/catalog-import'

export default defineEventHandler(async (event) => {
  const actor = await requireCapability(event, 'CLINICAL_WRITE')
  return addDoctorMilestone(actor, doctorMilestoneSchema.parse(await readBody(event)))
})
