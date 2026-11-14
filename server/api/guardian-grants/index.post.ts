import { defineEventHandler, readBody } from 'h3'
import { z } from 'zod'
import { requireCapability } from '../../services/access'
import { grantGuardian, guardianContactSchema } from '../../services/invitations'

export default defineEventHandler(async (event) => {
  const actor = await requireCapability(event, 'GUARDIAN_GRANT')
  const body = z.strictObject({ patientId: z.uuid(), contact: guardianContactSchema }).parse(await readBody(event))
  return grantGuardian(actor, body.patientId, body.contact)
})
