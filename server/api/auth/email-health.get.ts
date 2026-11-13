import { defineEventHandler } from 'h3'
import { requireCapability } from '../../services/access'
import { emailProviderHealth } from '../../services/email'

export default defineEventHandler(async (event) => {
  await requireCapability(event, 'ADMINISTER')
  return { state: await emailProviderHealth() }
})
