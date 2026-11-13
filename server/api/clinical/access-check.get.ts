import { defineEventHandler } from 'h3'
import { requireCapability } from '../../services/access'

export default defineEventHandler(async (event) => {
  await requireCapability(event, 'CLINICAL_READ')
  return { allowed: true }
})
