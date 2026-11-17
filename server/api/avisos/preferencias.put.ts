import { createError, defineEventHandler, readBody } from 'h3'
import { requireCapability } from '../../services/access'
import { getNoticePreferences, noticePreferencesSchema, setEmailNoticePreference, setWhatsAppNoticePreference } from '../../services/notice-preferences'

export default defineEventHandler(async (event) => {
  const actor = await requireCapability(event, 'PORTAL_READ')
  const input = noticePreferencesSchema.safeParse(await readBody(event))
  if (!input.success) throw createError({ statusCode: 400, statusMessage: 'Preferencia inválida' })
  if (input.data.email !== undefined) await setEmailNoticePreference(actor, input.data.email)
  if (input.data.whatsapp !== undefined) return setWhatsAppNoticePreference(actor, input.data.whatsapp)
  return getNoticePreferences(actor)
})
