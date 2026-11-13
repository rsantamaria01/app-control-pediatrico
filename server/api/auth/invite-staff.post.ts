import { defineEventHandler, readBody } from 'h3'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { user, userRole } from '../../db/schema'
import { useDb } from '../../utils/db'
import { requireCapability } from '../../services/access'
import { createSetupLink } from '../../services/invitation'
import { sendLink, markEmailFailure } from '../../services/email'
import { recordAudit } from '../../services/audit'

export default defineEventHandler(async (event) => {
  const actor = await requireCapability(event, 'ADMINISTER')
  const body = z.object({ email: z.email(), name: z.string().min(1), role: z.enum(['DOCTOR', 'ASSISTANT']) }).parse(await readBody(event))
  const id = randomUUID()
  await useDb().transaction(async (tx) => {
    await tx.insert(user).values({ id, email: body.email.toLowerCase(), name: body.name })
    await tx.insert(userRole).values({ userId: id, role: body.role })
  })
  try {
    await sendLink(body.email, await createSetupLink(id, 'SETUP', 7))
    await recordAudit('STAFF_INVITE', 'ALLOWED', actor.id, id)
  } catch (error) {
    await markEmailFailure()
    await recordAudit('STAFF_INVITE', 'DENIED', actor.id, id)
    console.error(JSON.stringify({ event: 'staff_invite_failed', email: 'redacted', provider: 'smtp', errorClass: error instanceof Error ? error.name : 'Unknown' }))
  }
  return { accepted: true }
})
