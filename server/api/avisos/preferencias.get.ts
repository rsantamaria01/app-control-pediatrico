import { defineEventHandler } from 'h3'
import { requireCapability } from '../../services/access'
import { getNoticePreferences } from '../../services/notice-preferences'

export default defineEventHandler(async event => getNoticePreferences(await requireCapability(event, 'PORTAL_READ')))
