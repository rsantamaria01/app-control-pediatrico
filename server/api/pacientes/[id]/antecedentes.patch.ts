import { createError, defineEventHandler, getRouterParam, readBody } from 'h3'
import { z } from 'zod'
import { requireCapability } from '../../../services/access'
import { updatePatientBackground } from '../../../services/patients'

const backgroundSchema = z.strictObject({
  gestationDays: z.number().int().min(140).max(301).optional(),
  correctionUntilMonths: z.union([z.literal(24), z.literal(36)]).optional(),
  birthWeightKg: z.number().positive().max(20).optional(),
  birthLengthCm: z.number().positive().max(80).optional(),
  birthHeadCircumferenceCm: z.number().positive().max(60).optional(),
  perinatalNotes: z.string().trim().max(10000).optional()
})

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400 })
  const actor = await requireCapability(event, 'CLINICAL_WRITE', id)
  return updatePatientBackground(actor, id, backgroundSchema.parse(await readBody(event)))
})
