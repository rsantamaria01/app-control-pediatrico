import { createError, defineEventHandler, readBody } from 'h3'
import { whatsappSettingsSchema } from '../../../../shared/types/notification'
import { requireCapability } from '../../../services/access'
import { saveWhatsAppSettings } from '../../../services/whatsapp-settings'

export default defineEventHandler(async (event) => {
  const actor = await requireCapability(event, 'ADMINISTER')
  const input = whatsappSettingsSchema.safeParse(await readBody(event))
  if (!input.success) throw createError({ statusCode: 400, statusMessage: 'Configuración de WhatsApp inválida' })
  try {
    return await saveWhatsAppSettings(actor, input.data)
  } catch {
    throw createError({ statusCode: 503, statusMessage: 'No se pudo guardar la configuración de WhatsApp' })
  }
})
