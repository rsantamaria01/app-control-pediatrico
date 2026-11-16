import { defineEventHandler } from 'h3'
import { requireCapability } from '../../services/access'
import { listInAppNotices } from '../../services/outbox'

export default defineEventHandler(async event => listInAppNotices(await requireCapability(event, 'PORTAL_READ')))
