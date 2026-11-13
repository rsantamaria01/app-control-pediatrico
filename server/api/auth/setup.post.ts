import { defineEventHandler, readBody, createError } from 'h3'
import { z } from 'zod'
import { setupCredential } from '../../services/invitation'

export default defineEventHandler(async (event) => {
  const body = z.object({ token: z.string().min(32), username: z.string().min(3), password: z.string().min(10) }).parse(await readBody(event))
  if (!await setupCredential(body.token, body.username, body.password)) throw createError({ statusCode: 400, statusMessage: 'Enlace inválido o vencido' })
  return { ok: true }
})
