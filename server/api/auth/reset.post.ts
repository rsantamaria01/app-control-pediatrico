import { defineEventHandler, readBody, createError } from 'h3'
import { z } from 'zod'
import { resetCredential } from '../../services/recovery'

export default defineEventHandler(async (event) => {
  const body = z.object({ token: z.string().min(32), password: z.string().min(10) }).parse(await readBody(event))
  if (!await resetCredential(body.token, body.password)) throw createError({ statusCode: 400, statusMessage: 'Enlace inválido o vencido' })
  return { ok: true }
})
