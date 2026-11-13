import { defineServerAuth } from '@nuxtjs/better-auth/config'
import { createAuthMiddleware, APIError, getIP } from 'better-auth/api'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { username } from 'better-auth/plugins'
import { eq } from 'drizzle-orm'
import { recordAudit } from './services/audit.js'
import * as schema from './db/schema.js'
import { normalizeUsername, validatePassword } from './services/credentials.js'
import { reserveLoginAttempt, releaseSuccessfulLoginIp, recordLoginFailure } from './services/otp-rate-limit.js'
import { useDb } from './utils/db.js'

export function trustedProxyIPSettings(cidr: string | undefined) {
  return cidr ? { ipAddressHeaders: ['x-forwarded-for'], trustedProxies: [cidr] } : { ipAddressHeaders: [] }
}

export default defineServerAuth({
  database: drizzleAdapter(useDb(), { provider: 'pg', schema }),
  trustedOrigins: process.env.NUXT_PUBLIC_SITE_URL ? [process.env.NUXT_PUBLIC_SITE_URL] : [],
  session: { expiresIn: 30 * 24 * 60 * 60, disableSessionRefresh: true },
  emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: 10, revokeSessionsOnPasswordReset: true },
  rateLimit: { enabled: false },
  advanced: { ipAddress: trustedProxyIPSettings(process.env.AUTH_TRUSTED_PROXY_CIDR) },
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path === '/sign-in/email') throw new APIError('UNAUTHORIZED', { message: 'Usuario o contraseña incorrectos' })
      if (ctx.path === '/sign-in/username') {
        const input = String(ctx.body?.username || '').toLowerCase()
        if (!/^[a-z0-9._-]{3,32}$/.test(input) || typeof ctx.body?.password !== 'string' || ctx.body.password.length > 128 || !ctx.body.password) {
          await recordAudit('SIGN_IN', 'DENIED')
          throw new APIError('UNAUTHORIZED', { message: 'Usuario o contraseña incorrectos' })
        }
        const ip = ctx.request ? getIP(ctx.request, ctx.context.options) || 'shared' : 'shared'
        try {
          if (!await reserveLoginAttempt(input, ip)) {
            await recordAudit('SIGN_IN', 'DENIED')
            throw new APIError('UNAUTHORIZED', { message: 'Usuario o contraseña incorrectos' })
          }
        } catch (error) {
          if (error instanceof APIError) throw error
          throw new APIError('SERVICE_UNAVAILABLE', { message: 'Acceso no disponible' })
        }
      }
      if (ctx.path === '/change-password' && ctx.body?.newPassword) {
        try {
          validatePassword(String(ctx.body.newPassword))
        } catch {
          throw new APIError('BAD_REQUEST', { message: 'Contraseña insegura' })
        }
        if (ctx.body.revokeOtherSessions !== true) throw new APIError('BAD_REQUEST', { message: 'Revocación de sesiones requerida' })
      }
    }),
    after: createAuthMiddleware(async (ctx) => {
      if (ctx.path === '/sign-in/username') {
        const success = Boolean(ctx.context.newSession?.user?.id)
        const input = String(ctx.body?.username || '').toLowerCase()
        const ip = ctx.request ? getIP(ctx.request, ctx.context.options) || 'shared' : 'shared'
        if (success) await releaseSuccessfulLoginIp(ip)
        else await recordLoginFailure(input, ip)
        await recordAudit('SIGN_IN', success ? 'ALLOWED' : 'DENIED', success ? ctx.context.newSession!.user.id : undefined)
        if (!success) throw new APIError('UNAUTHORIZED', { message: 'Usuario o contraseña incorrectos' })
      }
    })
  },
  databaseHooks: {
    session: {
      create: {
        before: async (session) => {
          const staff = await useDb().select({ role: schema.userRole.role }).from(schema.userRole).where(eq(schema.userRole.userId, session.userId))
          if (!staff.length) return false
          const expiresIn = staff.some(row => row.role !== 'PATIENT') ? 12 * 60 * 60 : 30 * 24 * 60 * 60
          return { data: { ...session, expiresAt: new Date(Date.now() + expiresIn * 1000) } }
        }
      }
    }
  },
  plugins: [username({
    minUsernameLength: 3,
    maxUsernameLength: 32,
    usernameNormalization: value => normalizeUsername(value),
    usernameValidator: value => /^[a-zA-Z0-9._-]{3,32}$/.test(value)
  })]
})
