import { defineEventHandler, readBody } from 'h3'
import { z } from 'zod'
import { requestRecovery } from '../../services/recovery'

export default defineEventHandler(async (event) => {
  const body = z.object({ identity: z.string().min(3).max(254) }).parse(await readBody(event))
  return requestRecovery(body.identity)
})
