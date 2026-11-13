import { expect, test } from '@playwright/test'
import { Pool } from 'pg'
import { createServer, type Socket } from 'node:net'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { hashPassword } from 'better-auth/crypto'
import { account, session, user, userRole } from '../../server/db/schema'
import { eq } from 'drizzle-orm'

const url = process.env.TEST_DATABASE_URL
const enabled = process.env.AUTH_E2E === '1'

test.describe('username/password access on disposable database', () => {
  test.skip(!enabled, 'Requires AUTH_E2E=1 and disposable test DB')
  let pool: Pool
  let db: ReturnType<typeof drizzle>
  const sockets = new Set<Socket>()
  const messages: string[] = []
  const smtp = createServer((socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    socket.write('220 mail.test ESMTP\r\n')
    let data = ''
    let collecting = false
    socket.on('data', (chunk) => {
      const text = chunk.toString()
      if (collecting) {
        data += text
        if (data.endsWith('\r\n.\r\n')) {
          messages.push(data)
          collecting = false
          socket.write('250 Accepted\r\n')
        }
      } else if (text.startsWith('EHLO')) socket.write('250 mail.test\r\n')
      else if (text.startsWith('MAIL FROM') || text.startsWith('RCPT TO')) socket.write('250 OK\r\n')
      else if (text.startsWith('DATA')) {
        data = ''
        collecting = true
        socket.write('354 Continue\r\n')
      } else if (text.startsWith('QUIT')) socket.end('221 Bye\r\n')
    })
  })
  test.beforeAll(async () => {
    await new Promise<void>(resolve => smtp.listen(1026, '127.0.0.1', resolve))
    if (!url || new URL(url).pathname !== '/pediatrico_auth_slice2_test' || url === process.env.DATABASE_URL) throw new Error('Dedicated auth test DB required')
    pool = new Pool({ connectionString: url })
    db = drizzle(pool)
    await migrate(db, { migrationsFolder: './server/db/migrations' })
  })
  test.afterAll(async () => {
    await pool?.end()
    for (const socket of sockets) socket.destroy()
    await new Promise<void>(resolve => smtp.close(() => resolve()))
  })

  test('phone and desktop sign in, generic wrong credentials and protected doctor access', async ({ page }) => {
    for (const width of [375, 1440]) {
      const id = crypto.randomUUID()
      const username = `doc-${id.slice(0, 8)}`
      const password = 'an ordinary long phrase'
      await db.insert(user).values({ id, email: `${id}@example.test`, name: 'Doctor', username })
      await db.insert(userRole).values({ userId: id, role: 'DOCTOR' })
      await db.insert(account).values({ id: crypto.randomUUID(), userId: id, accountId: id, providerId: 'credential', password: await hashPassword(password) })
      await page.setViewportSize({ width, height: 812 })
      await page.goto('/acceso')
      await page.waitForLoadState('networkidle')
      await page.getByRole('textbox', { name: 'Usuario' }).fill(username)
      await page.getByLabel('Contraseña').fill('incorrect phrase')
      await page.getByRole('button', { name: 'Ingresar' }).click()
      await expect(page.getByRole('alert')).toContainText('Usuario o contraseña incorrectos')
      await page.getByLabel('Contraseña').fill(password)
      await page.getByRole('button', { name: 'Ingresar' }).click()
      await expect(page).toHaveURL('/')
      expect((await page.request.get('/api/clinical/access-check')).status()).toBe(200)
      await page.context().clearCookies()
    }
  })

  test('phone and desktop invitation setup, recovery email and one-use password reset', async ({ page }) => {
    for (const width of [375, 1440]) {
      await page.setViewportSize({ width, height: 812 })
      const id = crypto.randomUUID()
      const username = `invited-${id.slice(0, 8)}`
      const email = `${id}@example.test`
      const { setupToken } = await import('../../server/db/schema')
      await db.insert(user).values({ id, email, name: 'Invited' })
      await db.insert(userRole).values({ userId: id, role: 'DOCTOR' })
      const { randomBytes, createHash } = await import('node:crypto')
      const setup = randomBytes(32).toString('base64url')
      await db.insert(setupToken).values({ id: crypto.randomUUID(), userId: id, digest: createHash('sha256').update(setup).digest('hex'), purpose: 'SETUP', expiresAt: new Date(Date.now() + 7 * 86400000) })
      await page.goto(`/invitacion/${setup}`)
      await page.waitForLoadState('networkidle')
      await page.getByRole('textbox', { name: 'Usuario' }).fill(username)
      await page.getByLabel('Contraseña').fill('a first unique passphrase')
      await page.getByRole('button', { name: 'Guardar acceso' }).click()
      await expect(page).toHaveURL('/acceso')
      await page.goto('/recuperar')
      await page.waitForLoadState('networkidle')
      await page.getByRole('textbox', { name: 'Usuario o email' }).fill(username)
      await page.getByRole('button', { name: 'Solicitar instrucciones' }).click()
      await expect(page.getByRole('status')).toBeVisible()
      await expect.poll(() => messages.filter(message => message.includes(email)).length).toBeGreaterThanOrEqual(1)
      const mail = messages.findLast(message => message.includes(email))!
      const token = mail.match(/restablecer\/([a-zA-Z0-9_-]{32,})/)?.[1]
      expect(token).toBeTruthy()
      const [entry] = (await db.select().from(setupToken).where(eq(setupToken.userId, id))).filter(item => item.purpose === 'RECOVERY')
      expect(entry!.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(600000)
      await page.goto(`/restablecer/${token}`)
      await page.waitForLoadState('networkidle')
      await page.getByLabel('Nueva contraseña').fill('a second unique passphrase')
      await page.getByRole('button', { name: 'Guardar contraseña' }).click()
      await expect(page).toHaveURL('/acceso')
      expect((await page.request.post('/api/auth/reset', { data: { token, password: 'another unique passphrase' } })).status()).toBe(400)
      await page.goto('/acceso')
      await page.waitForLoadState('networkidle')
      await page.getByRole('textbox', { name: 'Usuario' }).fill(username)
      await page.getByLabel('Contraseña').fill('a second unique passphrase')
      await page.getByRole('button', { name: 'Ingresar' }).click()
      await expect(page).toHaveURL('/')
      expect((await db.select().from(session).where(eq(session.userId, id))).length).toBeGreaterThan(0)
      await page.context().clearCookies()
    }
  })

  test('admin invites staff with server-authorized role and sends a setup link', async ({ page }) => {
    const id = crypto.randomUUID()
    const username = `admin-${id.slice(0, 8)}`
    await db.insert(user).values({ id, email: `${id}@example.test`, name: 'Admin', username })
    await db.insert(userRole).values({ userId: id, role: 'ADMIN' })
    await db.insert(account).values({ id: crypto.randomUUID(), userId: id, accountId: id, providerId: 'credential', password: await hashPassword('unique administrator passphrase') })
    await page.goto('/acceso')
    await page.waitForLoadState('networkidle')
    await page.getByRole('textbox', { name: 'Usuario' }).fill(username)
    await page.getByLabel('Contraseña').fill('unique administrator passphrase')
    await page.getByRole('button', { name: 'Ingresar' }).click()
    await expect(page).toHaveURL('/')
    const email = `${crypto.randomUUID()}@example.test`
    const response = await page.request.post('/api/auth/invite-staff', { data: { name: 'Staff', email, role: 'DOCTOR' } })
    expect(response.status()).toBe(200)
    await expect.poll(() => messages.filter(message => message.includes(email)).length).toBe(1)
    const mail = messages.findLast(message => message.includes(email))!
    const token = mail.match(/invitacion\/([a-zA-Z0-9_-]{32,})/)?.[1]
    expect(token).toBeTruthy()
    const [invited] = await db.select().from(user).where(eq(user.email, email))
    expect((await db.select().from(userRole).where(eq(userRole.userId, invited!.id))).map(row => row.role)).toEqual(['DOCTOR'])
    await page.context().clearCookies()
  })

  test('assistant cannot grant itself a doctor role through an invitation payload', async ({ page }) => {
    const id = crypto.randomUUID()
    const username = `assistant-${id.slice(0, 8)}`
    await db.insert(user).values({ id, email: `${id}@example.test`, name: 'Assistant', username })
    await db.insert(userRole).values({ userId: id, role: 'ASSISTANT' })
    await db.insert(account).values({ id: crypto.randomUUID(), userId: id, accountId: id, providerId: 'credential', password: await hashPassword('unique assistant passphrase') })
    await page.goto('/acceso')
    await page.waitForLoadState('networkidle')
    await page.getByRole('textbox', { name: 'Usuario' }).fill(username)
    await page.getByLabel('Contraseña').fill('unique assistant passphrase')
    await page.getByRole('button', { name: 'Ingresar' }).click()
    await expect(page).toHaveURL('/')
    const email = `${crypto.randomUUID()}@example.test`
    const denied = await page.request.post('/api/auth/invite-staff', { data: { email, name: 'False doctor', role: 'DOCTOR' } })
    expect(denied.status()).toBe(403)
    expect(await db.select().from(user).where(eq(user.email, email))).toHaveLength(0)
  })

  test('wrong credentials progressively lock the username on phone and desktop', async ({ page }) => {
    for (const width of [375, 1440]) {
      const id = crypto.randomUUID()
      const username = `locked-${id.slice(0, 8)}`
      await db.insert(user).values({ id, email: `${id}@example.test`, name: 'Doctor', username })
      await db.insert(userRole).values({ userId: id, role: 'DOCTOR' })
      await db.insert(account).values({ id: crypto.randomUUID(), userId: id, accountId: id, providerId: 'credential', password: await hashPassword('an ordinary unique phrase') })
      await page.setViewportSize({ width, height: 812 })
      await page.goto('/acceso')
      await page.waitForLoadState('networkidle')
      await page.getByRole('textbox', { name: 'Usuario' }).fill(username)
      for (let i = 0; i < 3; i++) {
        await page.getByLabel('Contraseña').fill('not the real password')
        await page.getByRole('button', { name: 'Ingresar' }).click()
        await expect(page.getByRole('alert')).toContainText('Usuario o contraseña incorrectos')
      }
      await page.getByLabel('Contraseña').fill('an ordinary unique phrase')
      await page.getByRole('button', { name: 'Ingresar' }).click()
      await expect(page.getByRole('alert')).toContainText('Usuario o contraseña incorrectos')
      expect((await db.select().from(session).where(eq(session.userId, id))).length).toBe(0)
    }
  })

  test('admin sees persisted SMTP failure state without exposing it publicly', async ({ page }) => {
    const id = crypto.randomUUID()
    const username = `health-${id.slice(0, 8)}`
    await db.insert(user).values({ id, email: `${id}@example.test`, name: 'Admin', username })
    await db.insert(userRole).values({ userId: id, role: 'ADMIN' })
    await db.insert(account).values({ id: crypto.randomUUID(), userId: id, accountId: id, providerId: 'credential', password: await hashPassword('unique health passphrase') })
    await page.goto('/acceso')
    await page.waitForLoadState('networkidle')
    await page.getByRole('textbox', { name: 'Usuario' }).fill(username)
    await page.getByLabel('Contraseña').fill('unique health passphrase')
    await page.getByRole('button', { name: 'Ingresar' }).click()
    await expect(page).toHaveURL('/')
    const health = await page.request.get('/api/auth/email-health')
    expect(health.status()).toBe(200)
    expect(['CONFIGURED', 'FAILING']).toContain((await health.json()).state)
    await page.context().clearCookies()
    expect((await page.request.get('/api/auth/email-health')).status()).toBe(401)
  })

  test('recovery never reveals whether the username exists', async ({ page }) => {
    await page.goto('/recuperar')
    await page.waitForLoadState('networkidle')
    await page.getByRole('textbox', { name: 'Usuario o email' }).fill(`missing-${crypto.randomUUID().slice(0, 8)}`)
    await page.getByRole('button', { name: 'Solicitar instrucciones' }).click()
    await expect(page.getByRole('status')).toHaveText('Si la cuenta existe, enviaremos instrucciones al correo registrado')
  })

  test('guest and assistant cannot read clinical endpoint', async ({ page }) => {
    expect((await page.request.get('/api/clinical/access-check')).status()).toBe(401)
    const id = crypto.randomUUID()
    const username = `assistant-${id.slice(0, 8)}`
    await db.insert(user).values({ id, email: `${id}@example.test`, name: 'Assistant', username })
    await db.insert(userRole).values({ userId: id, role: 'ASSISTANT' })
    await db.insert(account).values({ id: crypto.randomUUID(), userId: id, accountId: id, providerId: 'credential', password: await hashPassword('another long phrase') })
    await page.goto('/acceso')
    await page.waitForLoadState('networkidle')
    await page.getByRole('textbox', { name: 'Usuario' }).fill(username)
    await page.getByLabel('Contraseña').fill('another long phrase')
    await page.getByRole('button', { name: 'Ingresar' }).click()
    await expect(page).toHaveURL('/')
    expect((await page.request.get('/api/clinical/access-check')).status()).toBe(403)
    expect((await page.request.get('/api/auth/email-health')).status()).toBe(403)
    expect((await page.request.post('/api/auth/invite-staff', { data: { name: 'Unauthorized', email: 'no@example.test', role: 'DOCTOR' } })).status()).toBe(403)
  })
})
