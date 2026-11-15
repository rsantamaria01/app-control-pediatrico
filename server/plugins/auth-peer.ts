import { defineNitroPlugin } from 'nitropack/runtime'
import { applyAuthPeerAddress } from '../services/auth-peer'

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('request', (event) => {
    if (event.path.startsWith('/api/auth/')) applyAuthPeerAddress(event)
  })
})
