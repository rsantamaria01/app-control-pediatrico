import { auditEvent } from '../db/schema.js'
import { useDb } from '../utils/db.js'

export async function recordAudit(action: string, outcome: 'ALLOWED' | 'DENIED', actorId?: string, subjectId?: string) {
  await useDb().insert(auditEvent).values({ id: crypto.randomUUID(), action, outcome, actorId, subjectId })
}
