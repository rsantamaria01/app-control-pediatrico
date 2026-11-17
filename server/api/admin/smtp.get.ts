import { defineEventHandler } from 'h3'
import { requireCapability } from '../../services/access'
import { getSmtpSettings } from '../../services/smtp-settings'

export default defineEventHandler(async (event) => {
  await requireCapability(event, 'ADMINISTER')
  return getSmtpSettings()
})
