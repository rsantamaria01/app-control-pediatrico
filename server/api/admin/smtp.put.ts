import { createError, defineEventHandler, readBody } from 'h3'
import { smtpSettingsSchema } from '../../../shared/types/smtp'
import { requireCapability } from '../../services/access'
import { saveSmtpSettings } from '../../services/smtp-settings'

export default defineEventHandler(async (event) => {
  const actor = await requireCapability(event, 'ADMINISTER')
  const input = smtpSettingsSchema.safeParse(await readBody(event))
  if (!input.success) throw createError({ statusCode: 400, statusMessage: 'Configuración de correo inválida' })
  try {
    return await saveSmtpSettings(actor, input.data)
  } catch {
    throw createError({ statusCode: 503, statusMessage: 'No se pudo guardar la configuración de correo' })
  }
})
