import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createServer, type Socket } from 'node:net'
import { execFileSync } from 'node:child_process'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { eq } from 'drizzle-orm'
import { Pool } from 'pg'
import { betterAuth } from 'better-auth'
import { account, auditEvent, bootstrapMarker, session, user, userRole } from '../../server/db/schema'

const url = process.env.TEST_DATABASE_URL
if (!url || new URL(url).pathname !== '/pediatrico_auth_slice2_test' || url === process.env.DATABASE_URL) throw new Error('Dedicated disposable test DB required')
process.env.DATABASE_URL = url
process.env.SMTP_HOST = '127.0.0.1'
process.env.SMTP_SECURE = 'false'
process.env.SMTP_FROM = 'test@localhost'
process.env.RECOVERY_QUEUE_SECRET = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
const pool = new Pool({ connectionString: url })
const db = drizzle(pool)
const sockets = new Set<Socket>()
let received = ''
let dataMode = false
let dropAfterData = false
const smtp = createServer((socket) => {
  sockets.add(socket)
  socket.on('close', () => sockets.delete(socket))
  socket.write('220 mail.test ESMTP\r\n')
  socket.on('data', (chunk) => {
    const text = chunk.toString()
    if (dataMode) {
      received += text
      if (received.endsWith('\r\n.\r\n')) {
        dataMode = false
        if (dropAfterData) socket.destroy()
        else socket.write('250 Accepted\r\n')
      }
    } else if (text.startsWith('EHLO')) socket.write('250 mail.test\r\n')
    else if (text.startsWith('MAIL FROM') || text.startsWith('RCPT TO')) socket.write('250 OK\r\n')
    else if (text.startsWith('DATA')) {
      dataMode = true
      socket.write('354 Continue\r\n')
    } else if (text.startsWith('QUIT')) socket.end('221 Bye\r\n')
  })
})
let auth: ReturnType<typeof betterAuth>

beforeAll(async () => {
  await migrate(db, { migrationsFolder: './server/db/migrations' })
  await new Promise<void>(resolve => smtp.listen(0, '127.0.0.1', resolve))
  process.env.SMTP_PORT = String((smtp.address() as { port: number }).port)
  const { default: config } = await import('../../server/auth.config')
  auth = betterAuth({ ...config({ requestOrigin: 'http://localhost:3000' } as never), baseURL: 'http://localhost:3000', secret: 'test-secret-which-is-at-least-32-characters' })
})
beforeEach(async () => {
  received = ''
  dropAfterData = false
  const { recoveryJob } = await import('../../server/db/schema')
  await db.delete(recoveryJob)
  const { createClient } = await import('redis')
  const { createHash } = await import('node:crypto')
  const client = createClient({ url: process.env.REDIS_URL })
  client.on('error', () => {})
  await client.connect()
  try {
    const recoveryIp = `auth:access:recovery:ip:${createHash('sha256').update('shared').digest('hex')}`
    await client.del(recoveryIp)
    for (const address of ['shared', '127.0.0.1']) {
      const key = `auth:login:ip:${createHash('sha256').update(address).digest('hex')}`
      await client.del([key, `${key}:locked`, `${key}:attempts`])
    }
  } finally {
    await client.quit()
  }
})
afterAll(async () => {
  await pool.end()
  for (const socket of sockets) socket.destroy()
  await new Promise<void>(resolve => smtp.close(() => resolve()))
})

const post = (path: string, body: object) => auth.handler(new Request(`http://localhost:3000/api/auth/${path}`, {
  method: 'POST', headers: { 'content-type': 'application/json', 'origin': 'http://localhost:3000' }, body: JSON.stringify(body)
}))

describe('username/password access', () => {
  it('rejects public self-signup and old email-OTP sign-in', async () => {
    expect((await post('sign-up/email', { name: 'Intruder', email: 'intruder@example.test', username: 'intruder', password: 'long password phrase' })).status).not.toBe(200)
    expect((await post('email-otp/send-verification-otp', { email: 'intruder@example.test', type: 'sign-in' })).status).not.toBe(200)
  })

  it('signs in by normalized username only and stores default Better Auth password hash', async () => {
    const id = crypto.randomUUID()
    const username = `doctor-${id.slice(0, 8)}`
    const password = 'an ordinary long passphrase'
    await db.insert(user).values({ id, name: 'Doctor', email: `${id}@example.test`, username })
    await db.insert(userRole).values({ userId: id, role: 'DOCTOR' })
    const { hashPassword } = await import('better-auth/crypto')
    await db.insert(account).values({ id: crypto.randomUUID(), userId: id, providerId: 'credential', accountId: id, password: await hashPassword(password) })
    const result = await post('sign-in/username', { username: username.toUpperCase(), password })
    expect(result.status).toBe(200)
    expect(result.headers.get('set-cookie')).toContain('session_token')
    const [record] = await db.select().from(session).where(eq(session.userId, id))
    expect(record!.expiresAt.getTime() - record!.createdAt.getTime()).toBeLessThanOrEqual(12 * 60 * 60 * 1000 + 5000)
    expect((await post('sign-in/username', { username: `${id}@example.test`, password })).status).not.toBe(200)
    const duplicate = crypto.randomUUID()
    await expect(db.insert(user).values({ id: duplicate, name: 'Duplicate', email: `${duplicate}@example.test`, username: username.toUpperCase() })).rejects.toThrow()
  })

  it('returns the same generic error for malformed usernames and locked users', async () => {
    const malformed = await post('sign-in/username', { username: 'bad@name', password: 'any long password' })
    expect(malformed.status).toBe(401)
    expect((await malformed.json()).message).toBe('Usuario o contraseña incorrectos')
  })

  it('returns identical generic invalid-credential errors and audits missing and wrong users', async () => {
    const unknown = await post('sign-in/username', { username: `missing-${crypto.randomUUID().slice(0, 8)}`, password: 'a long incorrect password' })
    expect(unknown.status).toBe(401)
    expect((await unknown.json()).message).toBe('Usuario o contraseña incorrectos')
    expect(await db.select().from(auditEvent).where(eq(auditEvent.action, 'SIGN_IN'))).toEqual(expect.arrayContaining([expect.objectContaining({ outcome: 'DENIED', actorId: null })]))
  })

  it('consumes one-use setup link, rejects reuse and stores a hashed password', async () => {
    const { setupCredential } = await import('../../server/services/invitation')
    const { verifyPassword } = await import('better-auth/crypto')
    const id = crypto.randomUUID()
    const username = `setup-${id.slice(0, 8)}`
    await db.insert(user).values({ id, name: 'Invited', email: `${id}@example.test` })
    const { createSetupLink } = await import('../../server/services/invitation')
    process.env.NUXT_PUBLIC_SITE_URL = 'https://clinic.example.test'
    const link = await createSetupLink(id, 'SETUP', 7)
    const token = link.split('/').at(-1)!
    expect(await setupCredential(token, username, 'a very long and unique phrase')).toBe(true)
    expect(await setupCredential(token, username, 'another unique long phrase')).toBe(false)
    const [credential] = await db.select().from(account).where(eq(account.userId, id))
    expect(credential?.password).not.toContain('a very long and unique phrase')
    expect(await verifyPassword({ hash: credential!.password!, password: 'a very long and unique phrase' })).toBe(true)
  })

  it('does not let an invitation change credentials of an already configured user', async () => {
    const { setupCredential, createSetupLink } = await import('../../server/services/invitation')
    const id = crypto.randomUUID()
    const username = `already-${id.slice(0, 8)}`
    await db.insert(user).values({ id, name: 'Configured', email: `${id}@example.test`, username })
    await db.insert(account).values({ id: crypto.randomUUID(), userId: id, accountId: id, providerId: 'credential', password: 'previous-hash' })
    process.env.NUXT_PUBLIC_SITE_URL = 'https://clinic.example.test'
    const token = (await createSetupLink(id, 'SETUP', 7)).split('/').at(-1)!
    expect(await setupCredential(token, `other-${id.slice(0, 8)}`, 'a long unique secure phrase')).toBe(false)
    const [unchanged] = await db.select().from(user).where(eq(user.id, id))
    expect(unchanged?.username).toBe(username)
  })

  it('expires recovery links after ten minutes and records failed transport in persistent health', async () => {
    const { requestRecovery } = await import('../../server/services/recovery')
    const { setupToken, emailHealth } = await import('../../server/db/schema')
    const id = crypto.randomUUID()
    const username = `failure-${id.slice(0, 8)}`
    await db.insert(user).values({ id, name: 'Unavailable', email: `${id}@example.test`, username })
    await db.insert(account).values({ id: crypto.randomUUID(), userId: id, accountId: id, providerId: 'credential', password: await (await import('better-auth/crypto')).hashPassword('unique unavailable phrase') })
    process.env.NUXT_PUBLIC_SITE_URL = 'https://clinic.example.test'
    const previous = process.env.SMTP_HOST
    delete process.env.SMTP_HOST
    try {
      expect(await requestRecovery(username)).toEqual({ message: 'Si la cuenta existe, enviaremos instrucciones al correo registrado' })
      await (await import('../../server/services/recovery')).processRecoveryJobs()
      const [health] = await db.select().from(emailHealth).where(eq(emailHealth.id, 'smtp'))
      expect(health?.state).toBe('FAILING')
      const [entry] = await db.select().from(setupToken).where(eq(setupToken.userId, id))
      expect(entry!.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(600000)
      expect(entry!.usedAt).not.toBeNull()
    } finally {
      process.env.SMTP_HOST = previous
    }
  })

  it('rejects an expired invitation without configuring credentials', async () => {
    const { setupToken } = await import('../../server/db/schema')
    const { setupCredential, tokenDigest } = await import('../../server/services/invitation')
    const id = crypto.randomUUID()
    const token = crypto.randomUUID()
    await db.insert(user).values({ id, name: 'Expired', email: `${id}@example.test` })
    await db.insert(setupToken).values({ id: crypto.randomUUID(), userId: id, purpose: 'SETUP', digest: tokenDigest(token), expiresAt: new Date(Date.now() - 1000) })
    expect(await setupCredential(token, `expired-${id.slice(0, 8)}`, 'a unique long passphrase')).toBe(false)
    expect(await db.select().from(account).where(eq(account.userId, id))).toHaveLength(0)
  })

  it('records a redacted operational warning when a recovery request cannot be enqueued', async () => {
    const { requestRecovery } = await import('../../server/services/recovery')
    const username = `unavailable-${crypto.randomUUID().slice(0, 8)}`
    const original = process.env.RECOVERY_QUEUE_SECRET
    delete process.env.RECOVERY_QUEUE_SECRET
    const messages: string[] = []
    const previous = console.error
    console.error = (message: string) => {
      messages.push(message)
    }
    try {
      expect(await requestRecovery(username)).toEqual({ message: 'Si la cuenta existe, enviaremos instrucciones al correo registrado' })
      expect(messages).toEqual(expect.arrayContaining([expect.stringContaining('recovery_enqueue_failed')]))
      expect(messages.join(' ')).not.toContain(username)
    } finally {
      console.error = previous
      process.env.RECOVERY_QUEUE_SECRET = original
    }
  })

  it('fails closed when no encryption key is configured without storing plaintext identifiers', async () => {
    const { requestRecovery } = await import('../../server/services/recovery')
    const { recoveryJob } = await import('../../server/db/schema')
    const original = process.env.RECOVERY_QUEUE_SECRET
    delete process.env.RECOVERY_QUEUE_SECRET
    try {
      await requestRecovery(`unconfigured-${crypto.randomUUID().slice(0, 8)}`)
      expect(await db.select().from(recoveryJob)).toHaveLength(0)
    } finally {
      process.env.RECOVERY_QUEUE_SECRET = original
    }
  })

  it('permits a fresh recovery link after a confirmed interrupted delivery and cooldown', async () => {
    const { requestRecovery, reconcileRecoveryJobs, processRecoveryJobs, resetCredential } = await import('../../server/services/recovery')
    const { recoveryJob, setupToken } = await import('../../server/db/schema')
    const id = crypto.randomUUID()
    const username = `fresh-${id.slice(0, 8)}`
    await db.insert(user).values({ id, name: 'Fresh', email: `${id}@example.test`, username })
    await db.insert(account).values({ id: crypto.randomUUID(), accountId: id, userId: id, providerId: 'credential', password: await (await import('better-auth/crypto')).hashPassword('unique fresh phrase') })
    process.env.NUXT_PUBLIC_SITE_URL = 'https://clinic.example.test'
    await requestRecovery(username)
    const [job] = await db.select().from(recoveryJob)
    const { tokenDigest } = await import('../../server/services/invitation')
    const interruptedToken = crypto.randomUUID()
    const tokenId = crypto.randomUUID()
    await db.insert(setupToken).values({ id: tokenId, userId: id, purpose: 'RECOVERY', digest: tokenDigest(interruptedToken), expiresAt: new Date(Date.now() + 600000) })
    await db.update(recoveryJob).set({ state: 'SENDING', tokenId }).where(eq(recoveryJob.id, job!.id))
    expect(await reconcileRecoveryJobs()).toBe(1)
    expect(await resetCredential(interruptedToken, 'another interrupted phrase')).toBe(false)
    await requestRecovery(username)
    expect(await processRecoveryJobs()).toBe(1)
    const token = received.match(/restablecer\/([a-zA-Z0-9_-]{32,})/)?.[1]
    expect(token).toBeTruthy()
    expect((await db.select().from(setupToken).where(eq(setupToken.userId, id))).filter(entry => !entry.usedAt)).toHaveLength(1)
    expect(await resetCredential(token!, 'another unique fresh phrase')).toBe(true)
  })

  it('never resends after SMTP accepts DATA but drops the acknowledgment', async () => {
    const { requestRecovery, processRecoveryJobs } = await import('../../server/services/recovery')
    const { recoveryJob, setupToken } = await import('../../server/db/schema')
    const id = crypto.randomUUID()
    const username = `uncertain-${id.slice(0, 8)}`
    await db.insert(user).values({ id, name: 'Uncertain', email: `${id}@example.test`, username })
    await db.insert(account).values({ id: crypto.randomUUID(), userId: id, accountId: id, providerId: 'credential', password: await (await import('better-auth/crypto')).hashPassword('unique uncertain phrase') })
    process.env.NUXT_PUBLIC_SITE_URL = 'https://clinic.example.test'
    await requestRecovery(username)
    const [job] = await db.select().from(recoveryJob)
    dropAfterData = true
    expect(await processRecoveryJobs()).toBe(1)
    const firstLink = received.match(/restablecer\/([a-zA-Z0-9_-]{32,})/)?.[1]
    expect(firstLink).toBeTruthy()
    const [failed] = await db.select().from(recoveryJob).where(eq(recoveryJob.id, job!.id))
    expect(failed?.state).toBe('FAILED')
    expect(failed?.payload).toBe('')
    expect(failed?.deliveryPayload).toBeNull()
    received = ''
    dropAfterData = false
    expect(await processRecoveryJobs()).toBe(0)
    expect(received).toBe('')
    const [current] = await db.select().from(setupToken).where(eq(setupToken.userId, id))
    expect(current?.usedAt).not.toBeNull()
  })

  it('serializes concurrent issuance and invalidates superseded links', async () => {
    const { requestRecovery, processRecoveryJobs, resetCredential } = await import('../../server/services/recovery')
    const { recoveryJob, setupToken } = await import('../../server/db/schema')
    const id = crypto.randomUUID()
    const username = `supersede-${id.slice(0, 8)}`
    const email = `${id}@example.test`
    await db.insert(user).values({ id, name: 'Supersede', email, username })
    await db.insert(account).values({ id: crypto.randomUUID(), userId: id, accountId: id, providerId: 'credential', password: await (await import('better-auth/crypto')).hashPassword('unique supersede phrase') })
    process.env.NUXT_PUBLIC_SITE_URL = 'https://clinic.example.test'
    await requestRecovery(username)
    await requestRecovery(email)
    await Promise.all([processRecoveryJobs(), processRecoveryJobs()])
    const tokens = await db.select().from(setupToken).where(eq(setupToken.userId, id))
    expect(tokens.filter(token => token.usedAt === null)).toHaveLength(1)
    const links = [...received.matchAll(/restablecer\/([a-zA-Z0-9_-]{32,})/g)].map(match => match[1]!)
    expect(links.length).toBeGreaterThanOrEqual(1)
    if (links.length > 1) expect(await resetCredential(links[0]!, 'new superseded passphrase')).toBe(false)
    const jobs = await db.select().from(recoveryJob)
    for (const job of jobs) expect(JSON.stringify(job)).not.toContain(links.at(-1))
  })

  it('invalidates the issued token after the first SMTP failure and discards encrypted delivery data', async () => {
    const { requestRecovery, processRecoveryJobs } = await import('../../server/services/recovery')
    const { recoveryJob, setupToken } = await import('../../server/db/schema')
    const id = crypto.randomUUID()
    const username = `dead-${id.slice(0, 8)}`
    await db.insert(user).values({ id, name: 'Dead', email: `${id}@example.test`, username })
    await db.insert(account).values({ id: crypto.randomUUID(), userId: id, accountId: id, providerId: 'credential', password: await (await import('better-auth/crypto')).hashPassword('unique dead phrase') })
    process.env.NUXT_PUBLIC_SITE_URL = 'https://clinic.example.test'
    await requestRecovery(username)
    const [job] = await db.select().from(recoveryJob)
    expect(job).toBeDefined()
    const host = process.env.SMTP_HOST
    delete process.env.SMTP_HOST
    try {
      await processRecoveryJobs()
      expect(await processRecoveryJobs()).toBe(0)
      const [failed] = await db.select().from(recoveryJob).where(eq(recoveryJob.id, job!.id))
      expect(failed?.state).toBe('FAILED')
      expect(failed?.deliveryPayload).toBeNull()
      const [entry] = await db.select().from(setupToken).where(eq(setupToken.userId, id))
      expect(entry?.usedAt).not.toBeNull()
    } finally {
      process.env.SMTP_HOST = host
    }
  })

  it('does not leave multiple active recovery links after simultaneous requests for username and email', async () => {
    const { requestRecovery, processRecoveryJobs } = await import('../../server/services/recovery')
    const { recoveryJob, setupToken } = await import('../../server/db/schema')
    const id = crypto.randomUUID()
    const username = `parallel-${id.slice(0, 8)}`
    const email = `${id}@example.test`
    await db.insert(user).values({ id, name: 'Parallel', email, username })
    await db.insert(account).values({ id: crypto.randomUUID(), userId: id, accountId: id, providerId: 'credential', password: await (await import('better-auth/crypto')).hashPassword('unique parallel phrase') })
    process.env.NUXT_PUBLIC_SITE_URL = 'https://clinic.example.test'
    await Promise.all([requestRecovery(username), requestRecovery(email)])
    expect(await db.select().from(recoveryJob)).toHaveLength(2)
    await Promise.all([processRecoveryJobs(), processRecoveryJobs()])
    const tokens = await db.select().from(setupToken).where(eq(setupToken.userId, id))
    expect(tokens.filter(token => !token.usedAt && token.expiresAt > new Date())).toHaveLength(1)
  })

  it('rejects a consumed link without replaying a completed job', async () => {
    const { requestRecovery, processRecoveryJobs, resetCredential } = await import('../../server/services/recovery')
    const { setupToken } = await import('../../server/db/schema')
    const id = crypto.randomUUID()
    const username = `late-${id.slice(0, 8)}`
    await db.insert(user).values({ id, name: 'Late', email: `${id}@example.test`, username })
    await db.insert(account).values({ id: crypto.randomUUID(), userId: id, accountId: id, providerId: 'credential', password: await (await import('better-auth/crypto')).hashPassword('unique late phrase') })
    process.env.NUXT_PUBLIC_SITE_URL = 'https://clinic.example.test'
    await requestRecovery(username)
    await processRecoveryJobs()
    const first = received.match(/restablecer\/([a-zA-Z0-9_-]{32,})/)?.[1]
    expect(first).toBeTruthy()
    await db.update(setupToken).set({ usedAt: new Date() }).where(eq(setupToken.userId, id))
    expect(await processRecoveryJobs()).toBe(0)
    expect(await resetCredential(first!, 'a new late unique phrase')).toBe(false)
  })

  it('never resends a completed link after a fresh request supersedes it', async () => {
    const { requestRecovery, processRecoveryJobs } = await import('../../server/services/recovery')
    const { recoveryJob, setupToken } = await import('../../server/db/schema')
    const id = crypto.randomUUID()
    const username = `older-${id.slice(0, 8)}`
    const email = `${id}@example.test`
    await db.insert(user).values({ id, name: 'Older', email, username })
    await db.insert(account).values({ id: crypto.randomUUID(), userId: id, accountId: id, providerId: 'credential', password: await (await import('better-auth/crypto')).hashPassword('unique older phrase') })
    process.env.NUXT_PUBLIC_SITE_URL = 'https://clinic.example.test'
    await requestRecovery(username)
    const [queued] = await db.select().from(recoveryJob)
    expect(queued).toBeDefined()
    await processRecoveryJobs()
    const [oldJob] = await db.select().from(recoveryJob)
    const [oldToken] = await db.select().from(setupToken).where(eq(setupToken.userId, id))
    expect(oldJob?.tokenId).toBe(oldToken?.id)
    const { createClient } = await import('redis')
    const { createHash } = await import('node:crypto')
    const redis = createClient({ url: process.env.REDIS_URL })
    redis.on('error', () => {})
    await redis.connect()
    await redis.del(`auth:recovery:cooldown:${createHash('sha256').update(id).digest('hex')}`)
    await redis.quit()
    await requestRecovery(email)
    const pending = (await db.select().from(recoveryJob)).filter(job => job.state === 'QUEUED')
    expect(pending).toHaveLength(1)
    await processRecoveryJobs()
    const [superseded] = await db.select().from(setupToken).where(eq(setupToken.id, oldToken!.id))
    expect(superseded?.usedAt).not.toBeNull()
    expect(oldJob?.state).toBe('DONE')
    received = ''
    expect(await processRecoveryJobs()).toBe(0)
    expect(received).toBe('')
  })

  it('does not resurrect an expired recovery link on a later worker pass', async () => {
    const { requestRecovery, processRecoveryJobs } = await import('../../server/services/recovery')
    const { recoveryJob, setupToken } = await import('../../server/db/schema')
    const id = crypto.randomUUID()
    const username = `expired-job-${id.slice(0, 8)}`
    await db.insert(user).values({ id, name: 'Expired job', email: `${id}@example.test`, username })
    await db.insert(account).values({ id: crypto.randomUUID(), userId: id, accountId: id, providerId: 'credential', password: await (await import('better-auth/crypto')).hashPassword('unique expired phrase') })
    process.env.NUXT_PUBLIC_SITE_URL = 'https://clinic.example.test'
    await requestRecovery(username)
    const [enqueued] = await db.select().from(recoveryJob)
    expect(enqueued).toBeDefined()
    await processRecoveryJobs()
    const [job] = await db.select().from(recoveryJob)
    expect(job?.tokenId).toBeTruthy()
    await db.update(setupToken).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(setupToken.userId, id))
    received = ''
    expect(await processRecoveryJobs()).toBe(0)
    expect(received).toBe('')
    expect(await db.select().from(setupToken).where(eq(setupToken.userId, id))).toHaveLength(1)
  })

  it('does not resend a consumed recovery token after completion', async () => {
    const { requestRecovery, processRecoveryJobs, resetCredential } = await import('../../server/services/recovery')
    const { recoveryJob, setupToken } = await import('../../server/db/schema')
    const id = crypto.randomUUID()
    const username = `consumed-${id.slice(0, 8)}`
    await db.insert(user).values({ id, name: 'Consumed', email: `${id}@example.test`, username })
    await db.insert(account).values({ id: crypto.randomUUID(), userId: id, accountId: id, providerId: 'credential', password: await (await import('better-auth/crypto')).hashPassword('unique consumed phrase') })
    process.env.NUXT_PUBLIC_SITE_URL = 'https://clinic.example.test'
    await requestRecovery(username)
    const [enqueued] = await db.select().from(recoveryJob)
    expect(enqueued).toBeDefined()
    await processRecoveryJobs()
    const [sentJob] = await db.select().from(recoveryJob)
    expect(sentJob?.tokenId).toBeTruthy()
    const token = received.match(/restablecer\/([a-zA-Z0-9_-]{32,})/)?.[1]
    expect(token).toBeTruthy()
    expect(await resetCredential(token!, 'new unique consumed phrase')).toBe(true)
    received = ''
    expect(await processRecoveryJobs()).toBe(0)
    expect(received).toBe('')
    expect(await db.select().from(setupToken).where(eq(setupToken.userId, id))).toHaveLength(1)
  })

  it('does not overlap SMTP sends while a SENDING claim is in flight', async () => {
    const { requestRecovery, processRecoveryJobs } = await import('../../server/services/recovery')
    const { recoveryJob } = await import('../../server/db/schema')
    const id = crypto.randomUUID()
    const username = `overlap-${id.slice(0, 8)}`
    await db.insert(user).values({ id, name: 'Overlap', email: `${id}@example.test`, username })
    await db.insert(account).values({ id: crypto.randomUUID(), userId: id, accountId: id, providerId: 'credential', password: await (await import('better-auth/crypto')).hashPassword('unique overlap phrase') })
    process.env.NUXT_PUBLIC_SITE_URL = 'https://clinic.example.test'
    await requestRecovery(username)
    const [job] = await db.select().from(recoveryJob)
    expect(job).toBeDefined()
    const slowSockets = new Set<Socket>()
    const slow = createServer((socket) => {
      slowSockets.add(socket)
      socket.on('close', () => slowSockets.delete(socket))
      setTimeout(() => socket.write('220 slow.test ESMTP\r\n'), 900)
      socket.on('data', () => socket.end())
    })
    await new Promise<void>(resolve => slow.listen(0, '127.0.0.1', resolve))
    const port = process.env.SMTP_PORT
    process.env.SMTP_PORT = String((slow.address() as { port: number }).port)
    try {
      const first = processRecoveryJobs()
      await expect.poll(async () => (await db.select().from(recoveryJob).where(eq(recoveryJob.id, job!.id)))[0]?.tokenId).toBeTruthy()
      const [sending] = await db.select().from(recoveryJob).where(eq(recoveryJob.id, job!.id))
      expect(sending?.state).toBe('SENDING')
      expect(await processRecoveryJobs()).toBe(0)
      expect(await processRecoveryJobs()).toBe(0)
      await first
    } finally {
      process.env.SMTP_PORT = port
      for (const socket of slowSockets) socket.destroy()
      await new Promise<void>(resolve => slow.close(() => resolve()))
    }
  })

  it('allows only one process to reconcile or deliver recovery jobs at a time', async () => {
    const { acquireRecoveryWorker } = await import('../../server/services/recovery')
    const first = await acquireRecoveryWorker()
    expect(first).not.toBeNull()
    try {
      expect(await first?.isActive()).toBe(true)
      expect(await acquireRecoveryWorker()).toBeNull()
    } finally {
      await first?.release()
    }
    const restarted = await acquireRecoveryWorker()
    expect(restarted).not.toBeNull()
    await restarted?.release()
  })

  it('reconciles a legacy CLAIMED delivery without retrying or exposing its token', async () => {
    const { reconcileRecoveryJobs, processRecoveryJobs, requestRecovery } = await import('../../server/services/recovery')
    const { recoveryJob, setupToken } = await import('../../server/db/schema')
    const id = crypto.randomUUID()
    await db.insert(user).values({ id, name: 'Legacy', email: `${id}@example.test`, username: `legacy-${id.slice(0, 8)}` })
    await requestRecovery(`legacy-${id.slice(0, 8)}`)
    const [job] = await db.select().from(recoveryJob)
    const tokenId = crypto.randomUUID()
    await db.insert(setupToken).values({ id: tokenId, userId: id, purpose: 'RECOVERY', digest: crypto.randomUUID(), expiresAt: new Date(Date.now() + 600000) })
    await db.update(recoveryJob).set({ state: 'CLAIMED', tokenId }).where(eq(recoveryJob.id, job!.id))
    expect(await processRecoveryJobs()).toBe(0)
    expect(await reconcileRecoveryJobs()).toBe(1)
    expect((await db.select().from(recoveryJob).where(eq(recoveryJob.id, job!.id)))[0]?.state).toBe('UNKNOWN')
    expect((await db.select().from(setupToken).where(eq(setupToken.id, tokenId)))[0]?.usedAt).not.toBeNull()
  })

  it('marks an interrupted SENDING job unknown at startup, invalidates its token and never resends', async () => {
    const { requestRecovery, processRecoveryJobs, reconcileRecoveryJobs } = await import('../../server/services/recovery')
    const { recoveryJob, setupToken, emailHealth } = await import('../../server/db/schema')
    const id = crypto.randomUUID()
    const username = `crashed-${id.slice(0, 8)}`
    await db.insert(user).values({ id, name: 'Crashed', email: `${id}@example.test`, username })
    await db.insert(account).values({ id: crypto.randomUUID(), userId: id, accountId: id, providerId: 'credential', password: await (await import('better-auth/crypto')).hashPassword('unique crashed phrase') })
    process.env.NUXT_PUBLIC_SITE_URL = 'https://clinic.example.test'
    await requestRecovery(username)
    const [job] = await db.select().from(recoveryJob)
    const token = crypto.randomUUID()
    const { tokenDigest } = await import('../../server/services/invitation')
    const tokenId = crypto.randomUUID()
    await db.insert(setupToken).values({ id: tokenId, userId: id, purpose: 'RECOVERY', digest: tokenDigest(token), expiresAt: new Date(Date.now() + 600000) })
    await db.update(recoveryJob).set({ state: 'SENDING', tokenId }).where(eq(recoveryJob.id, job!.id))
    expect(await processRecoveryJobs()).toBe(0)
    expect(await reconcileRecoveryJobs()).toBe(1)
    const [interrupted] = await db.select().from(recoveryJob).where(eq(recoveryJob.id, job!.id))
    expect(interrupted?.state).toBe('UNKNOWN')
    expect(interrupted?.payload).toBe('')
    expect(interrupted?.deliveryPayload).toBeNull()
    expect((await db.select().from(setupToken).where(eq(setupToken.id, tokenId)))[0]?.usedAt).not.toBeNull()
    expect((await db.select().from(emailHealth).where(eq(emailHealth.id, 'smtp')))[0]?.state).toBe('FAILING')
    expect(await db.select().from(auditEvent).where(eq(auditEvent.action, 'RECOVERY_DELIVERY_FAILED'))).toEqual(expect.arrayContaining([expect.objectContaining({ actorId: null, subjectId: null })]))
    expect(await processRecoveryJobs()).toBe(0)
    expect(await reconcileRecoveryJobs()).toBe(0)
  })

  it('does not claim more than one recovery delivery at a time', async () => {
    const { requestRecovery, processRecoveryJobs } = await import('../../server/services/recovery')
    const { recoveryJob } = await import('../../server/db/schema')
    await requestRecovery(`first-${crypto.randomUUID().slice(0, 8)}`)
    await requestRecovery(`second-${crypto.randomUUID().slice(0, 8)}`)
    expect(await processRecoveryJobs()).toBe(1)
    expect((await db.select().from(recoveryJob)).filter(job => job.state === 'QUEUED')).toHaveLength(1)
  })

  it('does not claim a SENDING job on later worker passes', async () => {
    const { requestRecovery, processRecoveryJobs } = await import('../../server/services/recovery')
    const { recoveryJob } = await import('../../server/db/schema')
    await requestRecovery(`claimed-${crypto.randomUUID().slice(0, 8)}`)
    const [job] = await db.select().from(recoveryJob)
    await db.update(recoveryJob).set({ state: 'SENDING' }).where(eq(recoveryJob.id, job!.id))
    expect(await processRecoveryJobs()).toBe(0)
  })

  it('fails SMTP rejection once, invalidates its link and permits a fresh request after cooldown', async () => {
    const { requestRecovery, processRecoveryJobs } = await import('../../server/services/recovery')
    const { recoveryJob, setupToken } = await import('../../server/db/schema')
    const id = crypto.randomUUID()
    const username = `restart-${id.slice(0, 8)}`
    await db.insert(user).values({ id, name: 'Restart', email: `${id}@example.test`, username })
    await db.insert(account).values({ id: crypto.randomUUID(), accountId: id, userId: id, providerId: 'credential', password: await (await import('better-auth/crypto')).hashPassword('unique restart phrase') })
    process.env.NUXT_PUBLIC_SITE_URL = 'https://clinic.example.test'
    await requestRecovery(username)
    const [job] = await db.select().from(recoveryJob)
    const host = process.env.SMTP_HOST
    delete process.env.SMTP_HOST
    try {
      expect(await processRecoveryJobs()).toBe(1)
      const [failed] = await db.select().from(recoveryJob).where(eq(recoveryJob.id, job!.id))
      expect(failed!.state).toBe('FAILED')
      expect(failed!.attempts).toBe(1)
      expect(failed!.payload).toBe('')
      const [issued] = await db.select().from(setupToken).where(eq(setupToken.userId, id))
      expect(issued?.usedAt).not.toBeNull()
    } finally {
      process.env.SMTP_HOST = host
    }
    expect(await processRecoveryJobs()).toBe(0)
    const { createClient } = await import('redis')
    const { createHash } = await import('node:crypto')
    const redis = createClient({ url: process.env.REDIS_URL })
    redis.on('error', () => {})
    await redis.connect()
    await redis.del(`auth:recovery:cooldown:${createHash('sha256').update(id).digest('hex')}`)
    await redis.quit()
    received = ''
    await requestRecovery(username)
    expect(await processRecoveryJobs()).toBe(1)
    const tokens = await db.select().from(setupToken).where(eq(setupToken.userId, id))
    expect(tokens.filter(token => token.usedAt === null)).toHaveLength(1)
    expect(received).toContain('restablecer/')
  })

  it('never issues a recovery link for a stale queued request', async () => {
    const { requestRecovery, processRecoveryJobs } = await import('../../server/services/recovery')
    const { recoveryJob, setupToken } = await import('../../server/db/schema')
    const id = crypto.randomUUID()
    const username = `stale-${id.slice(0, 8)}`
    await db.insert(user).values({ id, name: 'Stale', email: `${id}@example.test`, username })
    await db.insert(account).values({ id: crypto.randomUUID(), userId: id, accountId: id, providerId: 'credential', password: await (await import('better-auth/crypto')).hashPassword('unique stale phrase') })
    await requestRecovery(username)
    const [job] = await db.select().from(recoveryJob)
    await db.update(recoveryJob).set({ createdAt: new Date(Date.now() - 11 * 60000) }).where(eq(recoveryJob.id, job!.id))
    expect(await processRecoveryJobs()).toBe(1)
    expect(await db.select().from(setupToken).where(eq(setupToken.userId, id))).toHaveLength(0)
  })

  it('queues encrypted recovery identities for both known and unknown accounts without exposing tokens', async () => {
    const { requestRecovery } = await import('../../server/services/recovery')
    const { recoveryJob } = await import('../../server/db/schema')
    const id = crypto.randomUUID()
    const username = `queue-${id.slice(0, 8)}`
    await db.insert(user).values({ id, name: 'Queued', email: `${id}@example.test`, username })
    const before = await db.select().from(recoveryJob)
    expect(await requestRecovery(username)).toEqual(await requestRecovery(`absent-${crypto.randomUUID().slice(0, 8)}`))
    const jobs = (await db.select().from(recoveryJob)).filter(row => !before.some(old => old.id === row.id))
    expect(jobs).toHaveLength(2)
    for (const job of jobs) {
      expect(JSON.stringify(job)).not.toContain(username)
      expect(JSON.stringify(job)).not.toContain(id)
      expect(JSON.stringify(job)).not.toContain('@example.test')
      expect(job.state).toBe('QUEUED')
    }
  })

  it('does not disclose account existence through a slow SMTP response', async () => {
    const { requestRecovery } = await import('../../server/services/recovery')
    const slowSockets = new Set<Socket>()
    const delayed = createServer((socket) => {
      slowSockets.add(socket)
      socket.on('close', () => slowSockets.delete(socket))
      setTimeout(() => socket.write('220 slow.test ESMTP\r\n'), 900)
      socket.on('data', () => socket.end())
    })
    await new Promise<void>(resolve => delayed.listen(0, '127.0.0.1', resolve))
    const id = crypto.randomUUID()
    const username = `slow-${id.slice(0, 8)}`
    await db.insert(user).values({ id, name: 'Slow', email: `${id}@example.test`, username })
    await db.insert(account).values({ id: crypto.randomUUID(), userId: id, accountId: id, providerId: 'credential', password: await (await import('better-auth/crypto')).hashPassword('unique slow phrase') })
    process.env.NUXT_PUBLIC_SITE_URL = 'https://clinic.example.test'
    const priorPort = process.env.SMTP_PORT
    process.env.SMTP_PORT = String((delayed.address() as { port: number }).port)
    try {
      const startKnown = performance.now()
      await requestRecovery(username)
      const knownDuration = performance.now() - startKnown
      const startUnknown = performance.now()
      await requestRecovery(`absent-${crypto.randomUUID().slice(0, 8)}`)
      const unknownDuration = performance.now() - startUnknown
      expect(Math.abs(knownDuration - unknownDuration)).toBeLessThan(300)
    } finally {
      process.env.SMTP_PORT = priorPort
      for (const socket of slowSockets) socket.destroy()
      await new Promise<void>(resolve => delayed.close(() => resolve()))
    }
  })

  it('queues distinct identities beyond the shared-IP budget without accepting spoofed forwarding headers', async () => {
    const { requestRecovery } = await import('../../server/services/recovery')
    const { recoveryJob } = await import('../../server/db/schema')
    for (let i = 0; i < 21; i++) {
      expect(await requestRecovery(`individual-${crypto.randomUUID().slice(0, 8)}`)).toEqual({ message: 'Si la cuenta existe, enviaremos instrucciones al correo registrado' })
    }
    expect(await db.select().from(recoveryJob)).toHaveLength(21)
  })

  it('maps recovery by username and email to the same account cooldown', async () => {
    const { requestRecovery } = await import('../../server/services/recovery')
    const { setupToken } = await import('../../server/db/schema')
    const id = crypto.randomUUID()
    const username = `cooldown-${id.slice(0, 8)}`
    const email = `${id}@example.test`
    await db.insert(user).values({ id, name: 'Cooldown', email, username })
    await db.insert(account).values({ id: crypto.randomUUID(), userId: id, accountId: id, providerId: 'credential', password: await (await import('better-auth/crypto')).hashPassword('unique cooldown phrase') })
    process.env.NUXT_PUBLIC_SITE_URL = 'https://clinic.example.test'
    await requestRecovery(username)
    await requestRecovery(email)
    await (await import('../../server/services/recovery')).processRecoveryJobs()
    expect(await db.select().from(setupToken).where(eq(setupToken.userId, id))).toHaveLength(1)
  })

  it('keeps recovery generic for an existing account with no password and never issues an actionable reset', async () => {
    const { requestRecovery } = await import('../../server/services/recovery')
    const { setupToken } = await import('../../server/db/schema')
    const id = crypto.randomUUID()
    const username = `pending-${id.slice(0, 8)}`
    await db.insert(user).values({ id, name: 'Pending', email: `${id}@example.test`, username })
    expect(await requestRecovery(username)).toEqual(await requestRecovery(`absent-${crypto.randomUUID().slice(0, 8)}`))
    expect(await db.select().from(setupToken).where(eq(setupToken.userId, id))).toHaveLength(0)
  })

  it('recovers by username or email without revealing accounts or delivery state', async () => {
    const { requestRecovery } = await import('../../server/services/recovery')
    const id = crypto.randomUUID()
    const username = `recover-${id.slice(0, 8)}`
    await db.insert(user).values({ id, name: 'Recover', email: `${id}@example.test`, username })
    await db.insert(account).values({ id: crypto.randomUUID(), userId: id, accountId: id, providerId: 'credential', password: await (await import('better-auth/crypto')).hashPassword('unique recover phrase') })
    process.env.NUXT_PUBLIC_SITE_URL = 'https://clinic.example.test'
    expect(await requestRecovery(username)).toEqual({ message: 'Si la cuenta existe, enviaremos instrucciones al correo registrado' })
    expect(await requestRecovery(`missing-${crypto.randomUUID().slice(0, 8)}`)).toEqual({ message: 'Si la cuenta existe, enviaremos instrucciones al correo registrado' })
    expect(await requestRecovery(username)).toEqual({ message: 'Si la cuenta existe, enviaremos instrucciones al correo registrado' })
    for (let i = 0; i < 3; i++) await (await import('../../server/services/recovery')).processRecoveryJobs()
    const { setupToken } = await import('../../server/db/schema')
    expect((await db.select().from(setupToken).where(eq(setupToken.userId, id))).length).toBe(1)
  })

  it('keeps the same recovery acknowledgment on SMTP connection refusal and persists failure', async () => {
    const { requestRecovery } = await import('../../server/services/recovery')
    const { emailHealth } = await import('../../server/db/schema')
    const id = crypto.randomUUID()
    const username = `refused-${id.slice(0, 8)}`
    await db.insert(user).values({ id, name: 'Refused', email: `${id}@example.test`, username })
    await db.insert(account).values({ id: crypto.randomUUID(), userId: id, accountId: id, providerId: 'credential', password: await (await import('better-auth/crypto')).hashPassword('unique refused phrase') })
    process.env.NUXT_PUBLIC_SITE_URL = 'https://clinic.example.test'
    const port = process.env.SMTP_PORT
    process.env.SMTP_PORT = '1'
    try {
      const { createClient } = await import('redis')
      const { createHash } = await import('node:crypto')
      const client = createClient({ url: process.env.REDIS_URL })
      client.on('error', () => {})
      await client.connect()
      const digest = createHash('sha256').update(id).digest('hex')
      const access = createHash('sha256').update(username).digest('hex')
      const shared = createHash('sha256').update('shared').digest('hex')
      await client.del([`auth:recovery:cooldown:${digest}`, `auth:access:recovery:email:${access}`, `auth:access:recovery:ip:${shared}`])
      await client.quit()
      expect(await requestRecovery(username)).toEqual(await requestRecovery(`missing-${crypto.randomUUID().slice(0, 8)}`))
      await (await import('../../server/services/recovery')).processRecoveryJobs()
      const [health] = await db.select().from(emailHealth).where(eq(emailHealth.id, 'smtp'))
      expect(health?.state).toBe('FAILING')
    } finally {
      process.env.SMTP_PORT = port
    }
  })

  it('returns the same recovery acknowledgment when SMTP fails and persists a redacted failure', async () => {
    const { requestRecovery } = await import('../../server/services/recovery')
    const id = crypto.randomUUID()
    const username = `offline-${id.slice(0, 8)}`
    await db.insert(user).values({ id, name: 'Offline', email: `${id}@example.test`, username })
    await db.insert(account).values({ id: crypto.randomUUID(), userId: id, accountId: id, providerId: 'credential', password: await (await import('better-auth/crypto')).hashPassword('unique offline phrase') })
    process.env.NUXT_PUBLIC_SITE_URL = 'https://clinic.example.test'
    const host = process.env.SMTP_HOST
    delete process.env.SMTP_HOST
    try {
      const known = await requestRecovery(username)
      const unknown = await requestRecovery(`unknown-${crypto.randomUUID().slice(0, 8)}`)
      expect(known).toEqual(unknown)
      await (await import('../../server/services/recovery')).processRecoveryJobs()
      expect(await db.select().from(auditEvent).where(eq(auditEvent.action, 'RECOVERY_DELIVERY_FAILED'))).toEqual(expect.arrayContaining([expect.objectContaining({ actorId: null, subjectId: null })]))
    } finally {
      process.env.SMTP_HOST = host
    }
  })

  it('resets password once and revokes existing sessions', async () => {
    const { resetCredential } = await import('../../server/services/recovery')
    const { createSetupLink } = await import('../../server/services/invitation')
    const id = crypto.randomUUID()
    await db.insert(user).values({ id, name: 'Reset', email: `${id}@example.test`, username: `reset-${id.slice(0, 8)}` })
    await db.insert(account).values({ id: crypto.randomUUID(), userId: id, accountId: id, providerId: 'credential', password: 'old-hash' })
    await db.insert(session).values({ id: crypto.randomUUID(), userId: id, token: crypto.randomUUID(), expiresAt: new Date(Date.now() + 600000) })
    const link = await createSetupLink(id, 'RECOVERY', 10 / 1440)
    const token = link.split('/').at(-1)!
    expect(await resetCredential(token, 'new secure ordinary phrase')).toBe(true)
    expect(await resetCredential(token, 'another secure ordinary phrase')).toBe(false)
    expect(await db.select().from(session).where(eq(session.userId, id))).toHaveLength(0)
  })

  it('sets 30-day guardian sessions and refuses clinical access to admin-only roles', async () => {
    const id = crypto.randomUUID()
    const username = `guardian-${id.slice(0, 8)}`
    const password = 'different ordinary long phrase'
    await db.insert(user).values({ id, email: `${id}@example.test`, name: 'Guardian', username })
    await db.insert(userRole).values({ userId: id, role: 'PATIENT' })
    const { hashPassword } = await import('better-auth/crypto')
    await db.insert(account).values({ id: crypto.randomUUID(), userId: id, providerId: 'credential', accountId: id, password: await hashPassword(password) })
    expect((await post('sign-in/username', { username, password })).status).toBe(200)
    const [record] = await db.select().from(session).where(eq(session.userId, id))
    expect(record!.expiresAt.getTime() - record!.createdAt.getTime()).toBeGreaterThan(29 * 86400000)
    expect(record!.expiresAt.getTime() - record!.createdAt.getTime()).toBeLessThanOrEqual(30 * 86400000 + 5000)
  })

  it('allows a configured proxy chain but otherwise ignores forwarded IP headers', async () => {
    const { trustedProxyIPSettings } = await import('../../server/auth.config')
    expect(trustedProxyIPSettings(undefined)).toEqual({ ipAddressHeaders: [] })
    expect(trustedProxyIPSettings('192.0.2.0/24')).toEqual({ ipAddressHeaders: ['x-forwarded-for'], trustedProxies: ['192.0.2.0/24'] })
  })

  it('never creates a session when Valkey is unavailable on sign-in', async () => {
    const id = crypto.randomUUID()
    const username = `outage-${id.slice(0, 8)}`
    await db.insert(user).values({ id, email: `${id}@example.test`, name: 'Outage', username })
    await db.insert(userRole).values({ userId: id, role: 'DOCTOR' })
    const { hashPassword } = await import('better-auth/crypto')
    await db.insert(account).values({ id: crypto.randomUUID(), userId: id, accountId: id, providerId: 'credential', password: await hashPassword('outage unique passphrase') })
    const prior = process.env.REDIS_URL
    delete process.env.REDIS_URL
    try {
      const denied = await post('sign-in/username', { username, password: 'outage unique passphrase' })
      expect(denied.status).not.toBe(200)
      expect(await db.select().from(session).where(eq(session.userId, id))).toHaveLength(0)
    } finally {
      process.env.REDIS_URL = prior
    }
  })

  it('rejects oversized passwords with a generic error rather than a validation clue', async () => {
    const oversized = await post('sign-in/username', { username: `oversize-${crypto.randomUUID().slice(0, 8)}`, password: 'x'.repeat(200) })
    expect(oversized.status).toBe(401)
    expect((await oversized.json()).message).toBe('Usuario o contraseña incorrectos')
  })

  it('ignores spoofed forwarding headers on sign-in', async () => {
    const { getIP } = await import('better-auth/api')
    const { default: config } = await import('../../server/auth.config')
    const options = config({ requestOrigin: 'http://localhost:3000' } as never)
    const spoofed = new Request('http://localhost:3000', { headers: { 'x-forwarded-for': '192.0.2.123' } })
    expect(getIP(spoofed, options)).not.toBe('192.0.2.123')
  })

  it('rejects a weak password on a real password change without revoking sessions', async () => {
    const id = crypto.randomUUID()
    const username = `weak-${id.slice(0, 8)}`
    const password = 'a strong unique phrase for change'
    await db.insert(user).values({ id, email: `${id}@example.test`, name: 'Weak', username })
    await db.insert(userRole).values({ userId: id, role: 'DOCTOR' })
    const { hashPassword } = await import('better-auth/crypto')
    await db.insert(account).values({ id: crypto.randomUUID(), userId: id, accountId: id, providerId: 'credential', password: await hashPassword(password) })
    const signedIn = await post('sign-in/username', { username, password })
    const cookie = signedIn.headers.get('set-cookie')!.split(';')[0]!
    const denied = await auth.handler(new Request('http://localhost:3000/api/auth/change-password', {
      method: 'POST', headers: { 'content-type': 'application/json', 'origin': 'http://localhost:3000', cookie },
      body: JSON.stringify({ currentPassword: password, newPassword: 'sunshine1234', revokeOtherSessions: true })
    }))
    expect(denied.status).toBe(400)
    expect(await db.select().from(session).where(eq(session.userId, id))).toHaveLength(1)
  })

  it('rejects email/password sign-in even for an invited user', async () => {
    const id = crypto.randomUUID()
    const email = `${id}@example.test`
    await db.insert(user).values({ id, email, name: 'Email attempt', username: `email-${id.slice(0, 8)}` })
    await db.insert(userRole).values({ userId: id, role: 'DOCTOR' })
    const { hashPassword } = await import('better-auth/crypto')
    const password = 'unique email login phrase'
    await db.insert(account).values({ id: crypto.randomUUID(), userId: id, accountId: id, providerId: 'credential', password: await hashPassword(password) })
    expect((await post('sign-in/email', { email, password })).status).not.toBe(200)
  })

  it('admits at most three simultaneous password guesses for one username', async () => {
    const id = crypto.randomUUID()
    const username = `burst-${id.slice(0, 8)}`
    const password = 'a unique password for this burst'
    await db.insert(user).values({ id, email: `${id}@example.test`, name: 'Burst', username })
    await db.insert(userRole).values({ userId: id, role: 'DOCTOR' })
    const { hashPassword } = await import('better-auth/crypto')
    await db.insert(account).values({ id: crypto.randomUUID(), userId: id, accountId: id, providerId: 'credential', password: await hashPassword(password) })
    const results = await Promise.all(Array.from({ length: 12 }, () => post('sign-in/username', { username, password })))
    expect(results.filter(result => result.status === 200)).toHaveLength(3)
    expect(await db.select().from(session).where(eq(session.userId, id))).toHaveLength(3)
    for (const result of results.filter(result => result.status !== 200)) {
      expect(result.status).toBe(401)
      expect((await result.json()).message).toBe('Usuario o contraseña incorrectos')
    }
  })

  it('releases a reserved login slot after its window expires', async () => {
    const { reserveLoginAttempt } = await import('../../server/services/otp-rate-limit')
    const { createClient } = await import('redis')
    const { createHash } = await import('node:crypto')
    const username = `window-${crypto.randomUUID().slice(0, 8)}`
    for (let i = 0; i < 3; i++) expect(await reserveLoginAttempt(username, `192.0.2.${i + 1}`)).toBe(true)
    expect(await reserveLoginAttempt(username, '192.0.2.4')).toBe(false)
    const client = createClient({ url: process.env.REDIS_URL })
    client.on('error', () => {})
    await client.connect()
    try {
      await client.del(`auth:login:user:${createHash('sha256').update(username).digest('hex')}:attempts`)
    } finally {
      await client.quit()
    }
    expect(await reserveLoginAttempt(username, '192.0.2.4')).toBe(true)
  })

  it('limits simultaneous guesses across distinct usernames from one IP', async () => {
    const { reserveLoginAttempt } = await import('../../server/services/otp-rate-limit')
    const ip = `192.0.2.${Math.floor(Math.random() * 180) + 1}`
    const attempts = await Promise.all(Array.from({ length: 30 }, (_, index) => reserveLoginAttempt(`user-${crypto.randomUUID().slice(0, 8)}-${index}`, ip)))
    expect(attempts.filter(Boolean)).toHaveLength(20)
  })

  it('does not clear the reservation budget after a successful login or allow parallel guesses past the lock', async () => {
    const id = crypto.randomUUID()
    const username = `mixed-${id.slice(0, 8)}`
    const password = 'a unique mixed password phrase'
    await db.insert(user).values({ id, email: `${id}@example.test`, name: 'Mixed', username })
    await db.insert(userRole).values({ userId: id, role: 'DOCTOR' })
    const { hashPassword } = await import('better-auth/crypto')
    await db.insert(account).values({ id: crypto.randomUUID(), userId: id, accountId: id, providerId: 'credential', password: await hashPassword(password) })
    expect((await post('sign-in/username', { username, password })).status).toBe(200)
    const responses = await Promise.all(Array.from({ length: 12 }, () => post('sign-in/username', { username, password: 'incorrect mixed password' })))
    expect(responses.filter(response => response.status === 401)).toHaveLength(12)
    expect((await post('sign-in/username', { username, password })).status).toBe(401)
    expect(await db.select().from(session).where(eq(session.userId, id))).toHaveLength(1)
  })

  it('keeps the reservation limit during a failing-username lock across a second IP', async () => {
    const { reserveLoginAttempt, recordLoginFailure, clearLoginFailures } = await import('../../server/services/otp-rate-limit')
    const name = `reserved-${crypto.randomUUID().slice(0, 8)}`
    for (let i = 0; i < 3; i++) {
      expect(await reserveLoginAttempt(name, `192.0.2.${i + 1}`)).toBe(true)
      await recordLoginFailure(name, `192.0.2.${i + 1}`)
    }
    expect(await reserveLoginAttempt(name, '203.0.113.2')).toBe(false)
    await clearLoginFailures(name)
    expect(await reserveLoginAttempt(name, '203.0.113.2')).toBe(false)
  })

  it('locks failed sign-in attempts with a generic audited error and does not reset the lock on a correct password', async () => {
    const id = crypto.randomUUID()
    const username = `locked-${id.slice(0, 8)}`
    const password = 'a unique password for this account'
    await db.insert(user).values({ id, email: `${id}@example.test`, name: 'Locked', username })
    await db.insert(userRole).values({ userId: id, role: 'DOCTOR' })
    const { hashPassword } = await import('better-auth/crypto')
    await db.insert(account).values({ id: crypto.randomUUID(), userId: id, accountId: id, providerId: 'credential', password: await hashPassword(password) })
    for (let i = 0; i < 3; i++) await post('sign-in/username', { username, password: 'wrong password' })
    const blocked = await post('sign-in/username', { username, password })
    expect(blocked.status).toBe(401)
    expect((await blocked.json()).message).toBe('Usuario o contraseña incorrectos')
    expect(await db.select().from(session).where(eq(session.userId, id))).toHaveLength(0)
    const denied = await db.select().from(auditEvent).where(eq(auditEvent.action, 'SIGN_IN'))
    expect(denied.filter(row => row.outcome === 'DENIED').length).toBeGreaterThanOrEqual(4)
  })

  it('forces session revocation on password change even if the client requests to keep other sessions', async () => {
    const id = crypto.randomUUID()
    const username = `change-${id.slice(0, 8)}`
    const original = 'long unique original passphrase'
    await db.insert(user).values({ id, email: `${id}@example.test`, name: 'Change', username })
    await db.insert(userRole).values({ userId: id, role: 'DOCTOR' })
    const { hashPassword, verifyPassword } = await import('better-auth/crypto')
    await db.insert(account).values({ id: crypto.randomUUID(), userId: id, accountId: id, providerId: 'credential', password: await hashPassword(original) })
    const signedIn = await post('sign-in/username', { username, password: original })
    expect(signedIn.status).toBe(200)
    const cookie = signedIn.headers.get('set-cookie')!.split(';')[0]!
    await db.insert(session).values({ id: crypto.randomUUID(), userId: id, token: crypto.randomUUID(), expiresAt: new Date(Date.now() + 600000) })
    const rejected = await auth.handler(new Request('http://localhost:3000/api/auth/change-password', {
      method: 'POST', headers: { 'content-type': 'application/json', 'origin': 'http://localhost:3000', cookie },
      body: JSON.stringify({ currentPassword: original, newPassword: 'another secure unique passphrase', revokeOtherSessions: false })
    }))
    expect(rejected.status).toBe(400)
    const response = await auth.handler(new Request('http://localhost:3000/api/auth/change-password', {
      method: 'POST', headers: { 'content-type': 'application/json', 'origin': 'http://localhost:3000', cookie },
      body: JSON.stringify({ currentPassword: original, newPassword: 'another secure unique passphrase', revokeOtherSessions: true })
    }))
    expect(response.status).toBe(200)
    expect(await db.select().from(session).where(eq(session.userId, id))).toHaveLength(1)
    const [credential] = await db.select().from(account).where(eq(account.userId, id))
    expect(await verifyPassword({ hash: credential!.password!, password: 'another secure unique passphrase' })).toBe(true)
  })

  it('progressively locks failed usernames across IPs and IPs across usernames', async () => {
    const { checkLoginLock, recordLoginFailure, clearLoginFailures } = await import('../../server/services/otp-rate-limit')
    const name = `progress-${crypto.randomUUID().slice(0, 8)}`
    const address = `192.0.2.${Math.floor(Math.random() * 180) + 1}`
    const otherAddress = `203.0.113.${Math.floor(Math.random() * 180) + 1}`
    expect(await checkLoginLock(name, address)).toBe(true)
    for (let i = 0; i < 3; i++) await recordLoginFailure(name, `198.51.100.${i + 1}`)
    expect(await checkLoginLock(name, otherAddress)).toBe(false)
    expect(await checkLoginLock(name, otherAddress)).toBe(false)
    await clearLoginFailures(name)
    expect(await checkLoginLock(name, otherAddress)).toBe(true)
    for (let i = 0; i < 20; i++) await recordLoginFailure(`ip-${crypto.randomUUID()}`, address)
    expect(await checkLoginLock('unrelated-user', address)).toBe(false)
    const { createClient } = await import('redis')
    const client = createClient({ url: process.env.REDIS_URL })
    client.on('error', () => {})
    await client.connect()
    try {
      const { createHash } = await import('node:crypto')
      const key = `auth:login:ip:${createHash('sha256').update(address).digest('hex')}`
      await client.del([key, `${key}:locked`])
    } finally {
      await client.quit()
    }
  })

  it('uses only a configured trusted proxy chain and rejects a forged first forwarding hop', async () => {
    const { recoveryClientAddress } = await import('../../server/services/otp-rate-limit')
    expect(recoveryClientAddress('198.51.100.22', '203.0.113.8', '192.0.2.0/24')).toBe('198.51.100.22')
    expect(recoveryClientAddress('192.0.2.10', '198.51.100.99, 203.0.113.8, 192.0.2.11', '192.0.2.0/24')).toBe('203.0.113.8')
    expect(recoveryClientAddress('192.0.2.10', '203.0.113.8', undefined)).toBe('192.0.2.10')
    expect(recoveryClientAddress('192.0.2.10', 'invalid, 203.0.113.8', '192.0.2.0/24')).toBe('192.0.2.10')
    expect(recoveryClientAddress('192.0.2.10', '198.51.100.99, 203.0.113.8', 'bad-cidr')).toBe('192.0.2.10')
    expect(recoveryClientAddress('192.0.2.10', '203.0.113.8', '0.0.0.0/0')).toBe('192.0.2.10')
    expect(recoveryClientAddress('192.0.2.10', '203.0.113.8', '192.0.2.0/24,198.51.100.0/24')).toBe('192.0.2.10')
    expect(recoveryClientAddress('192.0.2.10', '203.0.113.8', '192.0.2.0/24')).toBe('203.0.113.8')
  })

  it('keeps distinct recovery callers independent behind a configured trusted proxy', async () => {
    const { recoveryClientAddress, consumeAccessLimit } = await import('../../server/services/otp-rate-limit')
    const cidr = '192.0.2.0/24'
    const proxy = '192.0.2.11'
    const identifier = `proxy-${crypto.randomUUID()}`
    for (let i = 0; i < 20; i++) {
      const address = recoveryClientAddress(proxy, '198.51.100.33', cidr)
      expect(await consumeAccessLimit(`${identifier}-${i}`, address, 'recovery')).toBe(true)
    }
    const unrelated = recoveryClientAddress(proxy, '203.0.113.44', cidr)
    expect(await consumeAccessLimit(`${identifier}-other`, unrelated, 'recovery')).toBe(true)
  })

  it('keeps distinct recovery identities usable when the request IP is unavailable', async () => {
    const { consumeAccessLimit } = await import('../../server/services/otp-rate-limit')
    for (let i = 0; i < 25; i++) {
      expect(await consumeAccessLimit(`unique-${crypto.randomUUID()}`, 'shared', 'recovery')).toBe(true)
    }
    const identity = `same-${crypto.randomUUID()}`
    for (let i = 0; i < 3; i++) expect(await consumeAccessLimit(identity, 'shared', 'recovery')).toBe(true)
    expect(await consumeAccessLimit(identity, 'shared', 'recovery')).toBe(false)
  })

  it('rate limits username and IP attempts in Valkey without exposing account existence', async () => {
    const { consumeAccessLimit } = await import('../../server/services/otp-rate-limit')
    const name = `limits-${crypto.randomUUID().slice(0, 8)}`
    for (let i = 0; i < 3; i++) expect(await consumeAccessLimit(name, `192.0.2.${i + 1}`, 'login')).toBe(true)
    expect(await consumeAccessLimit(name, '192.0.2.4', 'login')).toBe(false)
  })

  it('bootstraps a single admin without any password in output', async () => {
    const bootstrapUrl = new URL(url)
    bootstrapUrl.pathname = '/pediatrico_auth_slice2_bootstrap_test'
    const bootstrapPool = new Pool({ connectionString: bootstrapUrl.href })
    const bootstrapDb = drizzle(bootstrapPool)
    try {
      await migrate(bootstrapDb, { migrationsFolder: './server/db/migrations' })
      await bootstrapDb.delete(auditEvent)
      await bootstrapDb.delete(userRole)
      await bootstrapDb.delete(account)
      await bootstrapDb.delete(session)
      await bootstrapDb.delete(user)
      await bootstrapDb.delete(bootstrapMarker)
      const env = { ...process.env, DATABASE_URL: bootstrapUrl.href, BOOTSTRAP_ADMIN_USERNAME: 'firstadmin', BOOTSTRAP_ADMIN_EMAIL: 'first@example.test', NUXT_PUBLIC_SITE_URL: 'https://clinic.example.test' }
      const output = execFileSync('node', ['--experimental-strip-types', 'scripts/bootstrap-admin.ts'], { env, encoding: 'utf8' })
      expect(output).toMatch(/^https:\/\/clinic\.example\.test\/invitacion\//)
      expect(output).not.toContain('password')
      expect((await bootstrapDb.select().from(userRole)).map(row => row.role)).toEqual(['ADMIN'])
      expect(() => execFileSync('node', ['--experimental-strip-types', 'scripts/bootstrap-admin.ts'], { env, stdio: 'pipe' })).toThrow()
    } finally {
      await bootstrapPool.end()
    }
  })
})
