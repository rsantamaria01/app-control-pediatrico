import { defineEventHandler, getQuery } from 'h3'
import { listEmulatableGuardians } from '../../../services/role-emulation'

export default defineEventHandler(async event => listEmulatableGuardians(event, String(getQuery(event).q ?? '')))
