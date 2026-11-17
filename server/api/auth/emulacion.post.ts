import { defineEventHandler, readBody } from 'h3'
import { z } from 'zod'
import { setEmulation } from '../../services/role-emulation'

const bodySchema = z.strictObject({ role: z.enum(['ADMIN', 'DOCTOR', 'ASSISTANT', 'PATIENT']), guardianId: z.string().uuid().optional() })

export default defineEventHandler(async (event) => {
  const { role, guardianId } = bodySchema.parse(await readBody(event))
  await setEmulation(event, role, guardianId)
  return { active: true }
})
