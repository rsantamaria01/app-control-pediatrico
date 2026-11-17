import { createError, defineEventHandler, getRequestURL } from 'h3'
import { emulationState } from '../services/role-emulation'

export default defineEventHandler(async (event) => {
  const method = event.method.toUpperCase()
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return
  const path = getRequestURL(event).pathname
  if (!path.startsWith('/api/') || path === '/api/auth/emulacion' || path.startsWith('/api/auth/emulacion/')) return
  const state = await emulationState(event)
  if (!state) return
  event.context.emulatedWrite = { adminId: state.adminId, role: state.role, userId: state.userId, method, path }
  if (path.startsWith('/api/auth/') && path !== '/api/auth/sign-out') throw createError({ statusCode: 403, statusMessage: 'Salir de emulación para cambiar la cuenta' })
})
