import { defineClientAuth } from '@nuxtjs/better-auth/config'
import { usernameClient } from 'better-auth/client/plugins'

export default defineClientAuth({ plugins: [usernameClient()] })
