import { defineEventHandler } from 'h3'
import { resolveActor } from '../../services/access'
import { shellNavigation } from '../../utils/shell-navigation'

export default defineEventHandler(async (event) => {
  const actor = await resolveActor(event)
  return shellNavigation(actor, ['/'])
})
