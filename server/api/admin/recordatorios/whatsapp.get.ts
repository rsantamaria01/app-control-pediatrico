import { defineEventHandler } from 'h3'
import { requireCapability } from '../../../services/access'
import { providerStatus } from '../../../services/outbox'
import { getWhatsAppSettings } from '../../../services/whatsapp-settings'

export default defineEventHandler(async (event) => {
  await requireCapability(event, 'ADMINISTER')
  return { ...await getWhatsAppSettings(), status: await providerStatus('WHATSAPP') }
})
