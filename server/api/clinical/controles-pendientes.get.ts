import { defineEventHandler } from 'h3'
import { requireCapability } from '../../services/access'
import { listPendingControls } from '../../services/controls-review'

export default defineEventHandler(async event => listPendingControls(await requireCapability(event, 'CLINICAL_READ')))
