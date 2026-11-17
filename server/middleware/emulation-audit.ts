import { defineEventHandler, getRequestURL } from 'h3'
import { auditEvent } from '../db/schema'
import { emulationState } from '../services/role-emulation'
import { useDb } from '../utils/db'

export default defineEventHandler(async (event) => {
  const method = event.method.toUpperCase()
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return
  const path = getRequestURL(event).pathname
  if (!path.startsWith('/api/') || path === '/api/auth/emulacion' || path.startsWith('/api/auth/emulacion/')) return
  const state = await emulationState(event)
  if (!state) return
  await useDb().insert(auditEvent).values({ id: crypto.randomUUID(), actorId: state.adminId, action: `EMULATED_${method}_${path}`.slice(0, 160), outcome: 'ALLOWED', subjectId: state.userId ?? state.adminId, emulatedRole: state.role, emulatedUserId: state.userId })
})
