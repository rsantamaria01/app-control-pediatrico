import { createError, defineEventHandler, getQuery, setHeader } from 'h3'
import { z } from 'zod'
import { resolveActor } from '../services/access'
import { searchCommands } from '../services/command-search'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const actor = await resolveActor(event)
  if (!actor) throw createError({ statusCode: 401, statusMessage: 'Authentication required' })
  const { q } = z.object({ q: z.string().max(100).default('') }).parse(getQuery(event))
  return searchCommands(actor, q)
})
