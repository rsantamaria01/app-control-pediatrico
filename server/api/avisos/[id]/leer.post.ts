import { defineEventHandler, getRouterParam } from 'h3'
import { z } from 'zod'
import { requireCapability } from '../../../services/access'
import { markInAppNoticeRead } from '../../../services/outbox'

export default defineEventHandler(async (event) => {
  const id = z.uuid().parse(getRouterParam(event, 'id'))
  const actor = await requireCapability(event, 'PORTAL_READ')
  await markInAppNoticeRead(actor, id)
  return { ok: true }
})
