import { defineEventHandler, readBody } from 'h3'
import { quickPatientSchema } from '../../../shared/types/patient-registration'
import { requireCapability } from '../../services/access'
import { createQuickPatient } from '../../services/patients'

export default defineEventHandler(async (event) => {
  const actor = await requireCapability(event, 'CLINICAL_WRITE')
  return createQuickPatient(actor, quickPatientSchema.parse(await readBody(event)))
})
