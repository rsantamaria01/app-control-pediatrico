import { defineEventHandler } from 'h3'
import { actualAdmin, emulationEnabled, emulationState } from '../../services/role-emulation'

export default defineEventHandler(async (event) => {
  if (!emulationEnabled()) return { available: false, active: null }
  try {
    await actualAdmin(event)
  } catch {
    return { available: false, active: null }
  }
  const active = await emulationState(event)
  return { available: true, active: active ? { role: active.role, name: active.name, userId: active.userId } : null }
})
