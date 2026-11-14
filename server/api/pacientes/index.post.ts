import { defineEventHandler, readBody } from 'h3'
import { patientSchema } from '../../../shared/types/measurement'
import { requireCapability } from '../../services/access'
import { createPatient } from '../../services/patients'

export default defineEventHandler(async (event) => {
  const actor = await requireCapability(event, 'CLINICAL_WRITE')
  return createPatient(actor, patientSchema.parse(await readBody(event)))
})
