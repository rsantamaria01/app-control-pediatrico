import { defineEventHandler, readBody } from 'h3'
import { z } from 'zod'
import { and, eq, inArray } from 'drizzle-orm'
import { account, user, userRole } from '../../db/schema'
import { useDb } from '../../utils/db'
import { requireCapability } from '../../services/access'
import { requestForcedRecovery } from '../../services/recovery'
import { recordAudit } from '../../services/audit'

export default defineEventHandler(async (event) => {
  const actor = await requireCapability(event, 'ADMINISTER')
  const { userId } = z.object({ userId: z.string().uuid() }).parse(await readBody(event))
  const db = useDb()
  const [target] = await db.select({ id: user.id }).from(user)
    .innerJoin(userRole, eq(userRole.userId, user.id))
    .innerJoin(account, and(eq(account.userId, user.id), eq(account.providerId, 'credential')))
    .where(and(eq(user.id, userId), inArray(userRole.role, ['DOCTOR', 'ASSISTANT', 'ADMIN']))).limit(1)
  if (target) {
    await requestForcedRecovery(target.id)
    await recordAudit('STAFF_FORCE_RESET', 'ALLOWED', actor.id, target.id)
  } else {
    await recordAudit('STAFF_FORCE_RESET', 'DENIED', actor.id)
  }
  return { accepted: true }
})
