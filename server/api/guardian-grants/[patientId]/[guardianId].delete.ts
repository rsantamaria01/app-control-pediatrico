import { defineEventHandler, getRouterParam } from 'h3'
import { z } from 'zod'
import { requireCapability } from '../../../services/access'
import { revokeGuardian } from '../../../services/invitations'

export default defineEventHandler(async (event) => {
  const actor = await requireCapability(event, 'GUARDIAN_GRANT')
  const patientId = z.uuid().parse(getRouterParam(event, 'patientId'))
  const guardianId = z.uuid().parse(getRouterParam(event, 'guardianId'))
  await revokeGuardian(actor, patientId, guardianId)
  return { ok: true }
})
