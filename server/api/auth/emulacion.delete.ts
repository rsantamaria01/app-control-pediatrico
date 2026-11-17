import { defineEventHandler } from 'h3'
import { setEmulation } from '../../services/role-emulation'

export default defineEventHandler(async event => {
  await setEmulation(event, null)
  return { active: false }
})
