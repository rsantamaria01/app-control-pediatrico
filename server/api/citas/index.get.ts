import { defineEventHandler, setHeader } from 'h3'
import { requireCapability } from '../../services/access'
import { listParentAppointments } from '../../services/booking'

export default defineEventHandler(async (event) => {
  const actor = await requireCapability(event, 'PORTAL_READ')
  setHeader(event, 'Cache-Control', 'private, no-store')
  return listParentAppointments(actor)
})
