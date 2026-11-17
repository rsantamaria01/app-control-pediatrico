import { createError, defineEventHandler, getRouterParam } from 'h3'
import { resolveActor } from '../../../services/access'
import { useDb } from '../../../utils/db'
import { staffNoticeRead } from '../../../db/schema'
import listStaffNotices from '../personal.get'

export default defineEventHandler(async (event) => {
  const actor = await resolveActor(event)
  if (!actor || !actor.roles.some(role => ['ADMIN', 'DOCTOR', 'ASSISTANT'].includes(role))) throw createError({ statusCode: 403, statusMessage: 'Access denied' })
  const id = getRouterParam(event, 'id')
  if (!id || id.length > 160 || !(await listStaffNotices(event)).some(notice => notice.id === id)) throw createError({ statusCode: 404, statusMessage: 'Notice not found' })
  await useDb().insert(staffNoticeRead).values({ userId: actor.id, noticeId: id }).onConflictDoNothing()
  return { ok: true }
})
