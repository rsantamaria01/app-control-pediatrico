import { defineEventHandler, createError } from 'h3'
import { resolveActor } from '../../services/access'
import { listDataRequests } from '../../services/data-requests'

export default defineEventHandler(async (event) => {
  const actor = await resolveActor(event)
  if (!actor) throw createError({ statusCode: 401, statusMessage: 'Authentication required' })
  return listDataRequests(actor)
})
