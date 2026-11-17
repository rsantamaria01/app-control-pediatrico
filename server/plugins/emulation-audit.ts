import { defineNitroPlugin } from 'nitropack/runtime'
import { auditEvent } from '../db/schema'
import { useDb } from '../utils/db'

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('beforeResponse', async (event) => {
    const write = event.context.emulatedWrite as { adminId: string, role: string, userId: string | null, method: string, path: string } | undefined
    if (!write) return
    await useDb().insert(auditEvent).values({ id: crypto.randomUUID(), actorId: write.adminId, action: `EMULATED_${write.method}_${write.path}`.slice(0, 160), outcome: event.res.status >= 400 ? 'DENIED' : 'ALLOWED', subjectId: write.userId ?? write.adminId, emulatedRole: write.role, emulatedUserId: write.userId })
  })
})
