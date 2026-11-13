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
  const rejectRecipients = new Set<string>()
  const holdRecipients = new Set<string>()
  const pendingAcknowledgments: Array<() => void> = []
  const smtp = createServer((socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    socket.write('220 mail.test ESMTP\r\n')
    let data = ''
    let collecting = false
    let recipient = ''
    socket.on('data', (chunk) => {
      const text = chunk.toString()
      if (collecting) {
        data += text
        if (data.endsWith('\r\n.\r\n')) {
          messages.push(data)
          collecting = false
          if ([...holdRecipients].some(email => recipient.includes(email))) pendingAcknowledgments.push(() => socket.write('250 Accepted\r\n'))
          else socket.write('250 Accepted\r\n')
        }
      } else if (text.startsWith('EHLO')) socket.write('250 mail.test\r\n')
      else if (text.startsWith('RCPT TO')) {
        recipient = text
        socket.write(rejectRecipients.size && [...rejectRecipients].some(email => text.includes(email)) ? '550 Recipient rejected\r\n' : '250 OK\r\n')
      } else if (text.startsWith('MAIL FROM')) socket.write('250 OK\r\n')
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

  test('admin retries a failed invitation without duplicating or escalating the staff account', async ({ page }) => {
    const adminId = crypto.randomUUID()
    const username = `admin-${adminId.slice(0, 8)}`
    await db.insert(user).values({ id: adminId, email: `${adminId}@example.test`, name: 'Admin', username })
    await db.insert(userRole).values({ userId: adminId, role: 'ADMIN' })
    await db.insert(account).values({ id: crypto.randomUUID(), userId: adminId, accountId: adminId, providerId: 'credential', password: await hashPassword('unique administrator passphrase') })
    await page.goto('/acceso')
    await page.waitForLoadState('networkidle')
    await page.getByRole('textbox', { name: 'Usuario' }).fill(username)
    await page.getByLabel('Contraseña').fill('unique administrator passphrase')
    await page.getByRole('button', { name: 'Ingresar' }).click()
    await expect(page).toHaveURL('/')
    const email = `${crypto.randomUUID()}@example.test`
    rejectRecipients.add(email)
    try {
      const first = await page.request.post('/api/auth/invite-staff', { data: { name: 'New doctor', email, role: 'DOCTOR' } })
      expect(first.status()).toBe(200)
      const [invited] = await db.select().from(user).where(eq(user.email, email))
      expect(invited).toBeDefined()
      const { setupToken } = await import('../../server/db/schema')
      expect((await db.select().from(setupToken).where(eq(setupToken.userId, invited!.id))).filter(entry => !entry.usedAt)).toHaveLength(0)
      rejectRecipients.delete(email)
      const retry = await page.request.post('/api/auth/invite-staff', { data: { name: 'New doctor', email, role: 'DOCTOR' } })
      expect(retry.status()).toBe(200)
      await expect.poll(() => messages.filter(message => message.includes(email)).length).toBe(1)
      const escalation = await page.request.post('/api/auth/invite-staff', { data: { name: 'Changed name', email, role: 'ASSISTANT' } })
      expect(escalation.status()).toBe(200)
      expect(await db.select().from(user).where(eq(user.email, email))).toHaveLength(1)
      expect((await db.select().from(userRole).where(eq(userRole.userId, invited!.id))).map(row => row.role)).toEqual(['DOCTOR'])
    } finally {
      rejectRecipients.delete(email)
    }
  })

  test('a rejected replacement invitation leaves the previously delivered setup link usable', async ({ page }) => {
    const adminId = crypto.randomUUID()
    const username = `admin-${adminId.slice(0, 8)}`
    await db.insert(user).values({ id: adminId, email: `${adminId}@example.test`, name: 'Admin', username })
    await db.insert(userRole).values({ userId: adminId, role: 'ADMIN' })
    await db.insert(account).values({ id: crypto.randomUUID(), userId: adminId, accountId: adminId, providerId: 'credential', password: await hashPassword('unique administrator passphrase') })
    await page.goto('/acceso')
    await page.waitForLoadState('networkidle')
    await page.getByRole('textbox', { name: 'Usuario' }).fill(username)
    await page.getByLabel('Contraseña').fill('unique administrator passphrase')
    await page.getByRole('button', { name: 'Ingresar' }).click()
    await expect(page).toHaveURL('/')
    const email = `${crypto.randomUUID()}@example.test`
    const invite = () => page.request.post('/api/auth/invite-staff', { data: { email, name: 'Doctor', role: 'DOCTOR' } })
    expect((await invite()).status()).toBe(200)
    const first = messages.findLast(message => message.includes(email))?.match(/invitacion\/([a-zA-Z0-9_-]{32,})/)?.[1]
    expect(first).toBeTruthy()
    rejectRecipients.add(email)
    try {
      expect((await invite()).status()).toBe(200)
      const { setupToken } = await import('../../server/db/schema')
      const [invited] = await db.select().from(user).where(eq(user.email, email))
      const active = (await db.select().from(setupToken).where(eq(setupToken.userId, invited!.id))).filter(row => row.usedAt === null)
      expect(active).toHaveLength(1)
      const { createHash } = await import('node:crypto')
      expect(active[0]?.digest).toBe(createHash('sha256').update(first!).digest('hex'))
      expect((await page.request.post('/api/auth/setup', { data: { token: first, username: `doctor-${adminId.slice(0, 8)}`, password: 'a new unique invitation phrase' } })).status()).toBe(200)
    } finally {
      rejectRecipients.delete(email)
    }
  })

  test('keeps the delivered setup link valid while replacement SMTP acceptance is pending', async ({ page }) => {
    const adminId = crypto.randomUUID()
    const username = `admin-${adminId.slice(0, 8)}`
    await db.insert(user).values({ id: adminId, email: `${adminId}@example.test`, name: 'Admin', username })
    await db.insert(userRole).values({ userId: adminId, role: 'ADMIN' })
    await db.insert(account).values({ id: crypto.randomUUID(), userId: adminId, accountId: adminId, providerId: 'credential', password: await hashPassword('unique administrator passphrase') })
    await page.goto('/acceso')
    await page.waitForLoadState('networkidle')
    await page.getByRole('textbox', { name: 'Usuario' }).fill(username)
    await page.getByLabel('Contraseña').fill('unique administrator passphrase')
    await page.getByRole('button', { name: 'Ingresar' }).click()
    await expect(page).toHaveURL('/')
    const email = `${crypto.randomUUID()}@example.test`
    const invite = () => page.request.post('/api/auth/invite-staff', { data: { email, name: 'Doctor', role: 'DOCTOR' } })
    expect((await invite()).status()).toBe(200)
    const first = messages.findLast(message => message.includes(email))!.match(/invitacion\/([a-zA-Z0-9_-]{32,})/)?.[1]
    expect(first).toBeTruthy()
    holdRecipients.add(email)
    try {
      const replacement = invite()
      await expect.poll(() => pendingAcknowledgments.length).toBe(1)
      const { setupToken } = await import('../../server/db/schema')
      const [invited] = await db.select().from(user).where(eq(user.email, email))
      const { createHash } = await import('node:crypto')
      const [old] = await db.select().from(setupToken).where(eq(setupToken.digest, createHash('sha256').update(first!).digest('hex')))
      expect(old?.userId).toBe(invited?.id)
      expect(old?.usedAt).toBeNull()
      const replacementToken = messages.findLast(message => message.includes(email))!.match(/invitacion\/([a-zA-Z0-9_-]{32,})/)?.[1]
      expect(replacementToken).toBeTruthy()
      const [prepared] = await db.select().from(setupToken).where(eq(setupToken.digest, createHash('sha256').update(replacementToken!).digest('hex')))
      expect(prepared).toBeUndefined()
      expect((await page.request.post('/api/auth/setup', { data: { token: replacementToken, username: `pending-${adminId.slice(0, 8)}`, password: 'a unique pending invitation phrase' } })).status()).toBe(400)
      pendingAcknowledgments.shift()!()
      expect((await replacement).status()).toBe(200)
      const [superseded] = await db.select().from(setupToken).where(eq(setupToken.id, old!.id))
      expect(superseded?.usedAt).not.toBeNull()
      const [active] = await db.select().from(setupToken).where(eq(setupToken.digest, createHash('sha256').update(replacementToken!).digest('hex')))
      expect(active?.usedAt).toBeNull()
    } finally {
      holdRecipients.delete(email)
      for (const acknowledge of pendingAcknowledgments.splice(0)) acknowledge()
    }
  })

  test('does not activate a replacement sent after the old invitation was redeemed in flight', async ({ page }) => {
    const adminId = crypto.randomUUID()
    const username = `admin-${adminId.slice(0, 8)}`
    await db.insert(user).values({ id: adminId, email: `${adminId}@example.test`, name: 'Admin', username })
    await db.insert(userRole).values({ userId: adminId, role: 'ADMIN' })
    await db.insert(account).values({ id: crypto.randomUUID(), userId: adminId, accountId: adminId, providerId: 'credential', password: await hashPassword('unique administrator passphrase') })
    await page.goto('/acceso')
    await page.waitForLoadState('networkidle')
    await page.getByRole('textbox', { name: 'Usuario' }).fill(username)
    await page.getByLabel('Contraseña').fill('unique administrator passphrase')
    await page.getByRole('button', { name: 'Ingresar' }).click()
    await expect(page).toHaveURL('/')
    const email = `${crypto.randomUUID()}@example.test`
    const invite = () => page.request.post('/api/auth/invite-staff', { data: { email, name: 'Doctor', role: 'DOCTOR' } })
    expect((await invite()).status()).toBe(200)
    const original = messages.findLast(message => message.includes(email))!.match(/invitacion\/([a-zA-Z0-9_-]{32,})/)?.[1]
    expect(original).toBeTruthy()
    holdRecipients.add(email)
    try {
      const replacement = invite()
      await expect.poll(() => pendingAcknowledgments.length).toBe(1)
      const [owner] = await db.select().from(user).where(eq(user.email, email))
      expect((await page.request.post('/api/auth/setup', { data: { token: original, username: `redeemed-${adminId.slice(0, 8)}`, password: 'a unique first setup passphrase' } })).status()).toBe(200)
      pendingAcknowledgments.shift()!()
      expect((await replacement).status()).toBe(200)
      const latest = messages.findLast(message => message.includes(email))!.match(/invitacion\/([a-zA-Z0-9_-]{32,})/)?.[1]
      expect(latest).toBeTruthy()
      const { createHash } = await import('node:crypto')
      const { setupToken } = await import('../../server/db/schema')
      const [sent] = await db.select().from(setupToken).where(eq(setupToken.digest, createHash('sha256').update(latest!).digest('hex')))
      expect(sent).toBeUndefined()
      expect((await page.request.post('/api/auth/setup', { data: { token: latest, username: `other-${adminId.slice(0, 8)}`, password: 'a unique second setup passphrase' } })).status()).toBe(400)
      expect((await db.select().from(account).where(eq(account.userId, owner!.id))).length).toBe(1)
      const { auditEvent } = await import('../../server/db/schema')
      expect((await db.select().from(auditEvent).where(eq(auditEvent.action, 'STAFF_INVITE'))).some(entry => entry.subjectId === owner!.id && entry.outcome === 'DENIED')).toBe(true)
    } finally {
      holdRecipients.delete(email)
      for (const acknowledge of pendingAcknowledgments.splice(0)) acknowledge()
    }
  })

  test('a replacement accepted first prevents the old setup link from configuring credentials', async ({ page }) => {
    const adminId = crypto.randomUUID()
    const username = `admin-${adminId.slice(0, 8)}`
    await db.insert(user).values({ id: adminId, email: `${adminId}@example.test`, name: 'Admin', username })
    await db.insert(userRole).values({ userId: adminId, role: 'ADMIN' })
    await db.insert(account).values({ id: crypto.randomUUID(), userId: adminId, accountId: adminId, providerId: 'credential', password: await hashPassword('unique administrator passphrase') })
    await page.goto('/acceso')
    await page.waitForLoadState('networkidle')
    await page.getByRole('textbox', { name: 'Usuario' }).fill(username)
    await page.getByLabel('Contraseña').fill('unique administrator passphrase')
    await page.getByRole('button', { name: 'Ingresar' }).click()
    await expect(page).toHaveURL('/')
    const email = `${crypto.randomUUID()}@example.test`
    const invite = () => page.request.post('/api/auth/invite-staff', { data: { email, name: 'Doctor', role: 'DOCTOR' } })
    expect((await invite()).status()).toBe(200)
    const previous = messages.findLast(message => message.includes(email))!.match(/invitacion\/([a-zA-Z0-9_-]{32,})/)?.[1]
    holdRecipients.add(email)
    try {
      const replacement = invite()
      await expect.poll(() => pendingAcknowledgments.length).toBe(1)
      pendingAcknowledgments.shift()!()
      const setup = page.request.post('/api/auth/setup', { data: { token: previous, username: `previous-${adminId.slice(0, 8)}`, password: 'a unique previous password' } })
      expect((await replacement).status()).toBe(200)
      expect((await setup).status()).toBe(400)
      const next = messages.findLast(message => message.includes(email))!.match(/invitacion\/([a-zA-Z0-9_-]{32,})/)?.[1]
      expect((await page.request.post('/api/auth/setup', { data: { token: next, username: `next-${adminId.slice(0, 8)}`, password: 'a unique next password' } })).status()).toBe(200)
    } finally {
      holdRecipients.delete(email)
      for (const acknowledge of pendingAcknowledgments.splice(0)) acknowledge()
    }
  })

  test('serializes the first accepted invitation against concurrent replacements', async ({ page }) => {
    const adminId = crypto.randomUUID()
    const username = `admin-${adminId.slice(0, 8)}`
    await db.insert(user).values({ id: adminId, email: `${adminId}@example.test`, name: 'Admin', username })
    await db.insert(userRole).values({ userId: adminId, role: 'ADMIN' })
    await db.insert(account).values({ id: crypto.randomUUID(), userId: adminId, accountId: adminId, providerId: 'credential', password: await hashPassword('unique administrator passphrase') })
    await page.goto('/acceso')
    await page.waitForLoadState('networkidle')
    await page.getByRole('textbox', { name: 'Usuario' }).fill(username)
    await page.getByLabel('Contraseña').fill('unique administrator passphrase')
    await page.getByRole('button', { name: 'Ingresar' }).click()
    await expect(page).toHaveURL('/')
    const email = `${crypto.randomUUID()}@example.test`
    holdRecipients.add(email)
    try {
      const invite = () => page.request.post('/api/auth/invite-staff', { data: { email, name: 'Doctor', role: 'DOCTOR' } })
      const first = invite()
      await expect.poll(() => pendingAcknowledgments.length).toBe(1)
      const second = invite()
      await new Promise(resolve => setTimeout(resolve, 1000))
      expect(pendingAcknowledgments).toHaveLength(1)
      pendingAcknowledgments.shift()!()
      expect((await first).status()).toBe(200)
      await expect.poll(() => pendingAcknowledgments.length).toBe(1)
      pendingAcknowledgments.shift()!()
      expect((await second).status()).toBe(200)
      const { setupToken } = await import('../../server/db/schema')
      const [invited] = await db.select().from(user).where(eq(user.email, email))
      expect((await db.select().from(setupToken).where(eq(setupToken.userId, invited!.id))).filter(row => !row.usedAt)).toHaveLength(1)
    } finally {
      holdRecipients.delete(email)
      for (const acknowledge of pendingAcknowledgments.splice(0)) acknowledge()
    }
  })

  test('a committed invitation cannot leave multiple setup links usable after concurrent sends', async ({ page }) => {
    const adminId = crypto.randomUUID()
    const username = `admin-${adminId.slice(0, 8)}`
    await db.insert(user).values({ id: adminId, email: `${adminId}@example.test`, name: 'Admin', username })
    await db.insert(userRole).values({ userId: adminId, role: 'ADMIN' })
    await db.insert(account).values({ id: crypto.randomUUID(), userId: adminId, accountId: adminId, providerId: 'credential', password: await hashPassword('unique administrator passphrase') })
    await page.goto('/acceso')
    await page.waitForLoadState('networkidle')
    await page.getByRole('textbox', { name: 'Usuario' }).fill(username)
    await page.getByLabel('Contraseña').fill('unique administrator passphrase')
    await page.getByRole('button', { name: 'Ingresar' }).click()
    await expect(page).toHaveURL('/')
    const email = `${crypto.randomUUID()}@example.test`
    const invite = () => page.request.post('/api/auth/invite-staff', { data: { email, name: 'Doctor', role: 'DOCTOR' } })
    const results = await Promise.all([invite(), invite(), invite()])
    expect(results.map(result => result.status())).toEqual([200, 200, 200])
    const [invited] = await db.select().from(user).where(eq(user.email, email))
    const { setupToken } = await import('../../server/db/schema')
    expect((await db.select().from(setupToken).where(eq(setupToken.userId, invited!.id))).filter(entry => !entry.usedAt)).toHaveLength(1)
  })

  test('a failed concurrent replacement keeps the earlier delivered link valid', async ({ page }) => {
    const adminId = crypto.randomUUID()
    const username = `admin-${adminId.slice(0, 8)}`
    await db.insert(user).values({ id: adminId, email: `${adminId}@example.test`, name: 'Admin', username })
    await db.insert(userRole).values({ userId: adminId, role: 'ADMIN' })
    await db.insert(account).values({ id: crypto.randomUUID(), userId: adminId, accountId: adminId, providerId: 'credential', password: await hashPassword('unique administrator passphrase') })
    await page.goto('/acceso')
    await page.waitForLoadState('networkidle')
    await page.getByRole('textbox', { name: 'Usuario' }).fill(username)
    await page.getByLabel('Contraseña').fill('unique administrator passphrase')
    await page.getByRole('button', { name: 'Ingresar' }).click()
    await expect(page).toHaveURL('/')
    const email = `${crypto.randomUUID()}@example.test`
    const invite = () => page.request.post('/api/auth/invite-staff', { data: { email, name: 'Doctor', role: 'DOCTOR' } })
    expect((await invite()).status()).toBe(200)
    const original = messages.findLast(message => message.includes(email))!.match(/invitacion\/([a-zA-Z0-9_-]{32,})/)?.[1]
    expect(original).toBeTruthy()
    rejectRecipients.add(email)
    const responses = await Promise.all([invite(), invite()])
    rejectRecipients.delete(email)
    expect(responses.map(result => result.status())).toEqual([200, 200])
    const [invited] = await db.select().from(user).where(eq(user.email, email))
    const { setupToken } = await import('../../server/db/schema')
    const active = (await db.select().from(setupToken).where(eq(setupToken.userId, invited!.id))).filter(entry => !entry.usedAt)
    const { createHash } = await import('node:crypto')
    expect(active.map(entry => entry.digest)).toEqual([createHash('sha256').update(original!).digest('hex')])
  })

  test('a pending replacement cannot be redeemed before SMTP accepts it', async ({ page }) => {
    const adminId = crypto.randomUUID()
    const username = `admin-${adminId.slice(0, 8)}`
    await db.insert(user).values({ id: adminId, email: `${adminId}@example.test`, name: 'Admin', username })
    await db.insert(userRole).values({ userId: adminId, role: 'ADMIN' })
    await db.insert(account).values({ id: crypto.randomUUID(), userId: adminId, accountId: adminId, providerId: 'credential', password: await hashPassword('unique administrator passphrase') })
    await page.goto('/acceso')
    await page.waitForLoadState('networkidle')
    await page.getByRole('textbox', { name: 'Usuario' }).fill(username)
    await page.getByLabel('Contraseña').fill('unique administrator passphrase')
    await page.getByRole('button', { name: 'Ingresar' }).click()
    await expect(page).toHaveURL('/')
    const email = `${crypto.randomUUID()}@example.test`
    const invite = () => page.request.post('/api/auth/invite-staff', { data: { email, name: 'Doctor', role: 'DOCTOR' } })
    expect((await invite()).status()).toBe(200)
    const first = messages.findLast(message => message.includes(email))!.match(/invitacion\/([a-zA-Z0-9_-]{32,})/)?.[1]
    expect(first).toBeTruthy()
    holdRecipients.add(email)
    try {
      const replacement = invite()
      await expect.poll(() => pendingAcknowledgments.length).toBe(1)
      const [invited] = await db.select().from(user).where(eq(user.email, email))
      const { setupToken } = await import('../../server/db/schema')
      const [old] = await db.select().from(setupToken).where(eq(setupToken.userId, invited!.id))
      expect(old?.usedAt).toBeNull()
      const replacementToken = messages.findLast(message => message.includes(email))!.match(/invitacion\/([a-zA-Z0-9_-]{32,})/)?.[1]
      expect(replacementToken).toBeTruthy()
      expect((await page.request.post('/api/auth/setup', { data: { token: replacementToken, username: `pending-${adminId.slice(0, 8)}`, password: 'a unique pending invitation phrase' } })).status()).toBe(400)
      pendingAcknowledgments.shift()!()
      expect((await replacement).status()).toBe(200)
      const [superseded] = await db.select().from(setupToken).where(eq(setupToken.id, old!.id))
      expect(superseded?.usedAt).not.toBeNull()
    } finally {
      holdRecipients.delete(email)
      for (const acknowledge of pendingAcknowledgments.splice(0)) acknowledge()
    }
  })

  test('concurrent staff invitations cannot fail on duplicate email or create duplicate identities', async ({ page }) => {
    const adminId = crypto.randomUUID()
    const username = `admin-${adminId.slice(0, 8)}`
    await db.insert(user).values({ id: adminId, email: `${adminId}@example.test`, name: 'Admin', username })
    await db.insert(userRole).values({ userId: adminId, role: 'ADMIN' })
    await db.insert(account).values({ id: crypto.randomUUID(), userId: adminId, accountId: adminId, providerId: 'credential', password: await hashPassword('unique administrator passphrase') })
    await page.goto('/acceso')
    await page.waitForLoadState('networkidle')
    await page.getByRole('textbox', { name: 'Usuario' }).fill(username)
    await page.getByLabel('Contraseña').fill('unique administrator passphrase')
    await page.getByRole('button', { name: 'Ingresar' }).click()
    await expect(page).toHaveURL('/')
    const email = `${crypto.randomUUID()}@example.test`
    const requests = await Promise.all(Array.from({ length: 4 }, () => page.request.post('/api/auth/invite-staff', { data: { email, name: 'Doctor', role: 'DOCTOR' } })))
    expect(requests.map(response => response.status())).toEqual([200, 200, 200, 200])
    const [invited] = await db.select().from(user).where(eq(user.email, email))
    expect(invited).toBeDefined()
    const { setupToken } = await import('../../server/db/schema')
    expect((await db.select().from(setupToken).where(eq(setupToken.userId, invited!.id))).filter(entry => !entry.usedAt)).toHaveLength(1)
    expect((await db.select().from(userRole).where(eq(userRole.userId, invited!.id))).map(row => row.role)).toEqual(['DOCTOR'])
  })

  test('admin forces a one-use reset for existing staff without changing their role or exposing a link', async ({ page }) => {
    const adminId = crypto.randomUUID()
    const username = `admin-${adminId.slice(0, 8)}`
    const password = 'unique administrator passphrase'
    await db.insert(user).values({ id: adminId, email: `${adminId}@example.test`, name: 'Admin', username })
    await db.insert(userRole).values({ userId: adminId, role: 'ADMIN' })
    await db.insert(account).values({ id: crypto.randomUUID(), userId: adminId, accountId: adminId, providerId: 'credential', password: await hashPassword(password) })
    const staffId = crypto.randomUUID()
    const staffEmail = `${staffId}@example.test`
    await db.insert(user).values({ id: staffId, email: staffEmail, name: 'Doctor', username: `doc-${staffId.slice(0, 8)}` })
    await db.insert(userRole).values({ userId: staffId, role: 'DOCTOR' })
    await db.insert(account).values({ id: crypto.randomUUID(), userId: staffId, accountId: staffId, providerId: 'credential', password: await hashPassword('old unique staff passphrase') })
    const guest = await page.request.post('/api/auth/force-reset', { data: { userId: staffId } })
    expect(guest.status()).toBe(401)
    await page.goto('/acceso')
    await page.waitForLoadState('networkidle')
    await page.getByRole('textbox', { name: 'Usuario' }).fill(username)
    await page.getByLabel('Contraseña').fill(password)
    await page.getByRole('button', { name: 'Ingresar' }).click()
    await expect(page).toHaveURL('/')
    const initial = await page.request.post('/api/auth/recovery', { data: { identity: `doc-${staffId.slice(0, 8)}` } })
    expect(initial.status()).toBe(200)
    await expect.poll(() => messages.filter(message => message.includes(staffEmail)).length).toBe(1)
    const previous = messages.findLast(message => message.includes(staffEmail))!.match(/restablecer\/([a-zA-Z0-9_-]{32,})/)?.[1]
    expect(previous).toBeTruthy()
    const result = await page.request.post('/api/auth/force-reset', { data: { userId: staffId } })
    expect(result.status()).toBe(200)
    expect(JSON.stringify(await result.json())).not.toContain('restablecer/')
    await expect.poll(() => messages.filter(message => message.includes(staffEmail)).length).toBe(2)
    const mail = messages.findLast(message => message.includes(staffEmail))!
    const token = mail.match(/restablecer\/([a-zA-Z0-9_-]{32,})/)?.[1]
    expect(token).toBeTruthy()
    expect((await page.request.post('/api/auth/reset', { data: { token: previous, password: 'a rejected old phrase' } })).status()).toBe(400)
    const reset = await page.request.post('/api/auth/reset', { data: { token, password: 'a new unique staff passphrase' } })
    expect(reset.status()).toBe(200)
    expect((await page.request.post('/api/auth/reset', { data: { token, password: 'another new unique phrase' } })).status()).toBe(400)
    expect((await db.select().from(userRole).where(eq(userRole.userId, staffId))).map(row => row.role)).toEqual(['DOCTOR'])
    const assistantId = crypto.randomUUID()
    const assistantEmail = `${assistantId}@example.test`
    await db.insert(user).values({ id: assistantId, email: assistantEmail, name: 'Assistant', username: `asst-${assistantId.slice(0, 8)}` })
    await db.insert(userRole).values({ userId: assistantId, role: 'ASSISTANT' })
    await db.insert(account).values({ id: crypto.randomUUID(), userId: assistantId, accountId: assistantId, providerId: 'credential', password: await hashPassword('old assistant passphrase') })
    expect((await page.request.post('/api/auth/force-reset', { data: { userId: assistantId } })).status()).toBe(200)
    await expect.poll(() => messages.filter(message => message.includes(assistantEmail)).length).toBe(1)
    const nonstaffId = crypto.randomUUID()
    const nonstaffEmail = `${nonstaffId}@example.test`
    await db.insert(user).values({ id: nonstaffId, email: nonstaffEmail, name: 'Guardian', username: `parent-${nonstaffId.slice(0, 8)}` })
    await db.insert(userRole).values({ userId: nonstaffId, role: 'PATIENT' })
    await db.insert(account).values({ id: crypto.randomUUID(), userId: nonstaffId, accountId: nonstaffId, providerId: 'credential', password: await hashPassword('unique guardian passphrase') })
    expect((await page.request.post('/api/auth/force-reset', { data: { userId: nonstaffId } })).status()).toBe(200)
    expect(messages.filter(message => message.includes(nonstaffEmail))).toHaveLength(0)
  })

  test('a second invitation invalidates an earlier delivered setup link without changing the role', async ({ page }) => {
    const adminId = crypto.randomUUID()
    const username = `admin-${adminId.slice(0, 8)}`
    await db.insert(user).values({ id: adminId, email: `${adminId}@example.test`, name: 'Admin', username })
    await db.insert(userRole).values({ userId: adminId, role: 'ADMIN' })
    await db.insert(account).values({ id: crypto.randomUUID(), userId: adminId, accountId: adminId, providerId: 'credential', password: await hashPassword('unique administrator passphrase') })
    await page.goto('/acceso')
    await page.waitForLoadState('networkidle')
    await page.getByRole('textbox', { name: 'Usuario' }).fill(username)
    await page.getByLabel('Contraseña').fill('unique administrator passphrase')
    await page.getByRole('button', { name: 'Ingresar' }).click()
    await expect(page).toHaveURL('/')
    const email = `${crypto.randomUUID()}@example.test`
    expect((await page.request.post('/api/auth/invite-staff', { data: { email, name: 'Doctor', role: 'DOCTOR' } })).status()).toBe(200)
    const first = messages.findLast(message => message.includes(email))!.match(/invitacion\/([a-zA-Z0-9_-]{32,})/)?.[1]
    expect(first).toBeTruthy()
    expect((await page.request.post('/api/auth/invite-staff', { data: { email, name: 'Doctor', role: 'DOCTOR' } })).status()).toBe(200)
    const second = messages.findLast(message => message.includes(email))!.match(/invitacion\/([a-zA-Z0-9_-]{32,})/)?.[1]
    expect(second).toBeTruthy()
    expect(second).not.toBe(first)
    expect((await page.request.post('/api/auth/setup', { data: { token: first, username: `first-${adminId.slice(0, 8)}`, password: 'unique first invitation phrase' } })).status()).toBe(400)
    expect((await page.request.post('/api/auth/setup', { data: { token: second, username: `second-${adminId.slice(0, 8)}`, password: 'unique second invitation phrase' } })).status()).toBe(200)
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

  test('thirty clinic staff can sign in behind one shared connection', async ({ page }) => {
    const password = 'a unique clinic team password'
    const hash = await hashPassword(password)
    for (let i = 0; i < 30; i++) {
      const id = crypto.randomUUID()
      const username = `staff-${id.slice(0, 8)}`
      await db.insert(user).values({ id, email: `${id}@example.test`, name: 'Staff', username })
      await db.insert(userRole).values({ userId: id, role: 'DOCTOR' })
      await db.insert(account).values({ id: crypto.randomUUID(), userId: id, accountId: id, providerId: 'credential', password: hash })
      const response = await page.request.post('/api/auth/sign-in/username', { data: { username, password }, headers: { origin: 'http://127.0.0.1:3000' } })
      expect(response.status()).toBe(200)
    }
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

  test('unrelated recovery requests are not denied by a shared IP, and forged forwarding cannot bypass identity limits', async ({ page }) => {
    const { recoveryJob } = await import('../../server/db/schema')
    const before = (await db.select().from(recoveryJob)).length
    for (let i = 0; i < 21; i++) {
      const result = await page.request.post('/api/auth/recovery', { data: { identity: `distinct-${crypto.randomUUID().slice(0, 8)}` }, headers: { 'x-forwarded-for': `198.51.100.${i + 1}` } })
      expect(result.status()).toBe(200)
    }
    expect((await db.select().from(recoveryJob)).length - before).toBe(21)
    const identity = `forged-${crypto.randomUUID().slice(0, 8)}`
    const count = (await db.select().from(recoveryJob)).length
    for (let i = 0; i < 4; i++) {
      const result = await page.request.post('/api/auth/recovery', { data: { identity }, headers: { 'x-forwarded-for': `192.0.2.${i + 1}` } })
      expect(result.status()).toBe(200)
    }
    expect((await db.select().from(recoveryJob)).length - count).toBe(3)
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
    expect((await page.request.post('/api/auth/force-reset', { data: { userId: id } })).status()).toBe(403)
    expect((await page.request.post('/api/auth/invite-staff', { data: { name: 'Unauthorized', email: 'no@example.test', role: 'DOCTOR' } })).status()).toBe(403)
  })
})
