import { createError, defineEventHandler, readBody } from 'h3'
import { z } from 'zod'
import { requireCapability } from '../../services/access'
import { setEmailNoticePreference } from '../../services/notice-preferences'

const schema = z.strictObject({ email: z.boolean() })

export default defineEventHandler(async (event) => {
  const actor = await requireCapability(event, 'PORTAL_READ')
  const input = schema.safeParse(await readBody(event))
  if (!input.success) throw createError({ statusCode: 400, statusMessage: 'Preferencia inválida' })
  return setEmailNoticePreference(actor, input.data.email)
})
