import { expect, test } from '@playwright/test'
import { Pool } from 'pg'
import { createHash, randomUUID } from 'node:crypto'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { hashPassword } from 'better-auth/crypto'
import { createServer, type Socket } from 'node:net'
import { account, guardianGrant, patient, setupToken, user, userRole, visit, visitResult, visitText } from '../../server/db/schema'
import { eq } from 'drizzle-orm'

const url = process.env.TEST_DATABASE_URL
const enabled = process.env.AUTH_E2E === '1' && process.env.CLINICAL_E2E === '1'

test.describe('verified guardian invitation and isolated portal', () => {
  test.skip(!enabled, 'Requires AUTH_E2E=1 CLINICAL_E2E=1 and disposable DB')
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
      else if (text.startsWith('RCPT TO') || text.startsWith('MAIL FROM')) socket.write('250 OK\r\n')
      else if (text.startsWith('DATA')) {
        data = ''
        collecting = true
        socket.write('354 Continue\r\n')
      } else if (text.startsWith('QUIT')) socket.end('221 Bye\r\n')
    })
  })
  test.beforeAll(async () => {
    if (!url || new URL(url).pathname !== '/pediatrico_auth_slice2_test' || url === process.env.DATABASE_URL || url !== process.env.CLINICAL_E2E_DATABASE_URL) throw new Error('Dedicated disposable E2E DB required')
    await new Promise<void>(resolve => smtp.listen(1026, '127.0.0.1', resolve))
    pool = new Pool({ connectionString: url })
    db = drizzle(pool)
    await migrate(db, { migrationsFolder: './server/db/migrations' })
  })
  test.afterAll(async () => {
    await pool?.end()
    for (const socket of sockets) socket.destroy()
    await new Promise<void>(resolve => smtp.close(() => resolve()))
  })

  test('doctor creates without email, adds it later, resends and parent sees shared home on phone and desktop', async ({ page }) => {
    for (const width of [375, 1440]) {
      await page.setViewportSize({ width, height: 812 })
      const doctorId = randomUUID()
      const username = `quick-${doctorId.slice(0, 8)}`
      const phone = `9${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`
      const email = `${randomUUID()}@example.test`
      const given = `Luz${doctorId.slice(0, 8)}`
      const password = 'unique clinical passphrase'
      await db.insert(user).values({ id: doctorId, name: 'Doctora', email: `${doctorId}@example.test`, username })
      await db.insert(userRole).values({ userId: doctorId, role: 'DOCTOR' })
      await db.insert(account).values({ id: randomUUID(), userId: doctorId, accountId: doctorId, providerId: 'credential', password: await hashPassword(password) })
      await page.goto('/acceso')
      await page.waitForLoadState('networkidle')
      await page.getByRole('textbox', { name: 'Usuario' }).fill(username)
      await page.getByLabel('Contraseña').fill(password)
      await page.getByRole('button', { name: 'Ingresar' }).click()
      await expect(page).toHaveURL('/')
      await page.goto('/pacientes/nuevo')
      await page.waitForLoadState('networkidle')
      await page.getByRole('textbox', { name: /^Nombres/ }).fill(given)
      await page.getByRole('textbox', { name: /^Apellidos/ }).fill('Mora')
      await page.getByLabel('Fecha de nacimiento').fill('2024-01-01')
      await page.getByRole('textbox', { name: 'Nombre completo' }).fill('Familia Portal')
      await page.getByRole('textbox', { name: 'Parentesco' }).fill('Madre')
      await page.getByRole('textbox', { name: 'Teléfono / WhatsApp' }).fill(phone)
      await expect(page.getByRole('switch', { name: 'Invitar al portal de padres' })).toBeDisabled()
      await page.getByRole('button', { name: 'Verificar representante' }).click()
      await expect(page.getByText('Sin cuenta previa')).toBeVisible()
      await page.getByRole('textbox', { name: 'Cómo verificó el vínculo' }).fill('Identidad comprobada en consulta')
      await page.getByRole('button', { name: 'Crear paciente' }).click()
      await expect(page.getByRole('heading', { name: `${given} Mora` })).toBeVisible()
      const childId = page.url().split('/').at(-1)!
      await expect(page.getByText('Sin invitar').first()).toBeVisible()
      const visitId = randomUUID()
      await db.insert(visit).values({ id: visitId, patientId: childId, requestId: randomUUID(), requestDigest: 'fixture', measuredAt: new Date('2025-01-01T12:00:00Z'), weightKg: '9', lengthHeightCm: '75', position: 'RECUMBENT', headCircumferenceCm: '45', bmi: '16', birthDateAtVisit: '2024-01-01', sexAtVisit: 'FEMALE', correctionUntilMonths: 24, authorId: doctorId })
      await db.insert(visitText).values({ visitId, privateNote: 'PRIVATE_NEVER_SHOW', parentAdvice: 'Volver a consulta en febrero' })
      await page.getByRole('link', { name: 'Invitar representante' }).click()
      await page.waitForLoadState('networkidle')
      await expect(page.getByRole('heading', { name: `Representante de ${given} Mora` })).toBeVisible()
      await page.getByRole('textbox', { name: 'Nombre del representante' }).fill('Familia Portal')
      await page.getByRole('textbox', { name: 'Correo del representante (para enviar invitación)' }).fill(email)
      await page.getByRole('textbox', { name: 'Teléfono / WhatsApp (si no hay correo)' }).fill(`0${phone}`)
      await page.getByRole('textbox', { name: 'Parentesco' }).fill('Madre')
      await page.getByRole('button', { name: 'Verificar representante' }).click()
      await expect(page.getByText(/Cuenta existente:/)).toBeVisible()
      await page.getByRole('checkbox', { name: 'Confirmo que es la misma persona' }).check()
      await page.getByRole('textbox', { name: 'Cómo verificó el vínculo' }).fill('Identidad comprobada en consulta')
      const before = messages.length
      await page.getByRole('button', { name: 'Registrar y enviar invitación' }).click()
      await expect.poll(async () => ({ status: await page.locator('[role="status"]').allInnerTexts(), count: messages.length })).toMatchObject({ status: expect.arrayContaining([expect.stringMatching(/pendiente|No se pudo/)]), count: expect.any(Number) })
      await expect.poll(() => messages.length).toBeGreaterThan(before)
      const firstToken = messages.at(-1)?.match(/invitacion\/([a-zA-Z0-9_-]{32,})/)?.[1]
      expect(firstToken).toBeTruthy()
      await page.getByRole('button', { name: 'Verificar representante' }).click()
      await expect(page.getByText(/Cuenta existente:/)).toBeVisible()
      await page.getByRole('checkbox', { name: 'Confirmo que es la misma persona' }).check()
      const current = await page.request.get(`/api/guardian-grants/${childId}`).then(response => response.json())
      expect(current.guardians).toEqual(expect.arrayContaining([expect.objectContaining({ email, status: 'PENDING' })]))
      await page.reload()
      await page.waitForLoadState('networkidle')
      await page.getByRole('textbox', { name: 'Nombre del representante' }).fill('Familia Portal')
      await page.getByRole('textbox', { name: 'Correo del representante (para enviar invitación)' }).fill(email)
      await page.getByRole('textbox', { name: 'Teléfono / WhatsApp (si no hay correo)' }).fill(`0${phone}`)
      await page.getByRole('textbox', { name: 'Parentesco' }).fill('Madre')
      await page.getByRole('button', { name: 'Verificar representante' }).click()
      await expect(page.getByText(/Cuenta existente:/)).toBeVisible()
      await page.getByRole('checkbox', { name: 'Confirmo que es la misma persona' }).check()
      await page.getByRole('textbox', { name: 'Cómo verificó el vínculo' }).fill('Identidad comprobada en consulta')
      await page.getByRole('button', { name: 'Reenviar invitación' }).click()
      await expect.poll(() => messages.length).toBeGreaterThan(before + 1)
      const token = messages.at(-1)?.match(/invitacion\/([a-zA-Z0-9_-]{32,})/)?.[1]
      expect(token).toBeTruthy()
      expect((await page.request.get(`/invitacion/${firstToken}`)).status()).toBe(200)
      await page.context().clearCookies()
      await page.goto(`/invitacion/${token}`)
      await page.waitForLoadState('networkidle')
      const parentUsername = `parent-${doctorId.slice(0, 8)}`
      await page.getByRole('textbox', { name: 'Usuario' }).fill(parentUsername)
      await page.getByLabel('Contraseña').fill('unique guardian passphrase')
      await page.getByRole('button', { name: 'Guardar acceso' }).click()
      await expect(page).toHaveURL('/acceso')
      await page.getByRole('textbox', { name: 'Usuario' }).fill(parentUsername)
      await page.getByLabel('Contraseña').fill('unique guardian passphrase')
      await page.getByRole('button', { name: 'Ingresar' }).click()
      await expect(page).toHaveURL('/')
      await expect(page.getByRole('heading', { name: 'Mis hijos' })).toBeVisible()
      await expect(page.getByText(`${given} Mora`)).toBeVisible()
      await expect(page.getByText('Volver a consulta en febrero')).toBeVisible()
      expect(await page.locator('main').innerText()).not.toMatch(/PRIVATE_NEVER_SHOW|puntaje Z|percentil/)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
      await page.context().clearCookies()
    }
  })

  test('assistant verifies and invites; parent sees only own child at 375 and 1440, revoke removes access', async ({ page }) => {
    for (const width of [375, 1440]) {
      messages.length = 0
      const assistantId = randomUUID()
      const username = `assistant-${assistantId.slice(0, 8)}`
      const ownId = randomUUID()
      const otherId = randomUUID()
      const email = `${randomUUID()}@example.test`
      const phone = `09${randomUUID().replace(/\D/g, '').padEnd(8, '0').slice(0, 8)}`
      await db.insert(user).values({ id: assistantId, name: 'Asistente', email: `${assistantId}@example.test`, username })
      await db.insert(userRole).values({ userId: assistantId, role: 'ASSISTANT' })
      await db.insert(account).values({ id: randomUUID(), userId: assistantId, accountId: assistantId, providerId: 'credential', password: await hashPassword('unique assistant passphrase') })
      await db.insert(patient).values([
        { id: ownId, name: `Niña ${ownId.slice(0, 8)}`, birthDate: '2024-01-01', sex: 'FEMALE', createdBy: assistantId },
        { id: otherId, name: `Otra ${otherId.slice(0, 8)}`, birthDate: '2024-01-01', sex: 'FEMALE', createdBy: assistantId }
      ])
      const visitId = randomUUID()
      await db.insert(visit).values({ id: visitId, patientId: ownId, requestId: randomUUID(), requestDigest: 'test', measuredAt: new Date('2025-01-01T12:00:00Z'), weightKg: '9', lengthHeightCm: '75', position: 'RECUMBENT', headCircumferenceCm: '45', bmi: '16', birthDateAtVisit: '2024-01-01', sexAtVisit: 'FEMALE', correctionUntilMonths: 24, authorId: assistantId })
      await db.insert(visitText).values({ visitId, privateNote: 'DO_NOT_EXPOSE_NOTE', parentAdvice: 'Conversar en consulta', clinicianTrend: 'DO_NOT_EXPOSE_TREND' })
      const privateVisitId = randomUUID()
      await db.insert(visit).values({ id: privateVisitId, patientId: ownId, requestId: randomUUID(), requestDigest: 'private', measuredAt: new Date('2025-02-01T12:00:00Z'), weightKg: '10', lengthHeightCm: '78', position: 'STANDING', headCircumferenceCm: '46', bmi: '16', shareWithFamily: false, birthDateAtVisit: '2024-01-01', sexAtVisit: 'FEMALE', correctionUntilMonths: 24, authorId: assistantId })
      await db.insert(visitText).values({ visitId: privateVisitId, privateNote: 'PRIVATE_FEBRUARY', parentAdvice: 'HIDDEN_ADVICE' })
      await db.insert(visitResult).values({ id: randomUUID(), visitId, indicator: 'WEIGHT_FOR_AGE', snapshot: { status: 'unavailable', reason: 'Referencia no disponible' }, calculatedBy: assistantId })
      await page.setViewportSize({ width, height: 812 })
      await page.goto('/acceso')
      await page.waitForLoadState('networkidle')
      await page.getByRole('textbox', { name: 'Usuario' }).fill(username)
      await page.getByLabel('Contraseña').fill('unique assistant passphrase')
      await page.getByRole('button', { name: 'Ingresar' }).click()
      await expect(page).toHaveURL('/')
      expect((await page.request.get(`/api/pacientes/${ownId}`)).status()).toBe(403)
      expect((await page.request.patch(`/api/pacientes/${ownId}/visitas/${visitId}/compartir`, { data: { shared: false } })).status()).toBe(403)
      expect((await page.request.get(`/api/hijos/${ownId}`)).status()).toBe(403)
      await page.goto('/representantes/invitar')
      await page.waitForLoadState('networkidle')
      await expect(page.getByRole('heading', { name: 'Invitar representante' })).toBeVisible()
      const lookup = await page.request.get(`/api/guardian-grants?q=${ownId.slice(0, 8)}`)
      expect(lookup.status()).toBe(200)
      expect(await lookup.json()).toEqual([{ id: ownId, name: `Niña ${ownId.slice(0, 8)}`, guardians: [] }])
      await page.getByRole('textbox', { name: 'Buscar niño o niña' }).fill(ownId.slice(0, 8))
      await expect(page.getByRole('button', { name: `Niña ${ownId.slice(0, 8)}` })).toBeVisible()
      expect(await page.locator('body').innerText()).not.toMatch(/DO_NOT_EXPOSE|9,00 kg|Z /)
      await page.getByRole('button', { name: `Niña ${ownId.slice(0, 8)}` }).click()
      await page.getByRole('textbox', { name: 'Nombre del representante' }).fill('Representante')
      await page.getByRole('textbox', { name: 'Correo del representante (para enviar invitación)' }).fill(email)
      await page.getByRole('textbox', { name: 'Teléfono / WhatsApp (si no hay correo)' }).fill(phone)
      await page.getByRole('textbox', { name: 'Parentesco' }).fill('Madre')
      await page.getByRole('button', { name: 'Verificar representante' }).click()
      await expect(page.getByText('Sin cuenta previa · Sin invitar')).toBeVisible()
      await page.getByRole('textbox', { name: 'Cómo verificó el vínculo' }).fill('Identificación presencial verificada')
      await page.getByRole('button', { name: 'Registrar y enviar invitación' }).click()
      await expect(page.getByRole('status')).toContainText('pendiente')
      await expect(page.getByText('Pendiente de activación')).toBeVisible()
      await expect.poll(() => messages.length).toBeGreaterThan(0)
      const token = messages.at(-1)?.match(/invitacion\/([a-zA-Z0-9_-]{32,})/)?.[1]
      expect(token).toBeTruthy()
      const [stored] = await db.select().from(setupToken).where(eq(setupToken.digest, createHash('sha256').update(token!).digest('hex')))
      expect(stored?.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(7 * 86400000)
      const [link] = await db.select().from(guardianGrant).where(eq(guardianGrant.patientId, ownId))
      expect(link).toMatchObject({ status: 'PENDING', contactPhone: phone, relationship: 'Madre' })
      await page.context().clearCookies()
      await page.goto(`/invitacion/${token}`)
      await page.waitForLoadState('networkidle')
      await page.getByRole('textbox', { name: 'Usuario' }).fill(`guardian-${ownId.slice(0, 8)}`)
      await page.getByLabel('Contraseña').fill('unique guardian passphrase')
      await page.getByRole('button', { name: 'Guardar acceso' }).click()
      await expect(page).toHaveURL('/acceso')
      await page.getByRole('textbox', { name: 'Usuario' }).fill(`guardian-${ownId.slice(0, 8)}`)
      await page.getByLabel('Contraseña').fill('unique guardian passphrase')
      await page.getByRole('button', { name: 'Ingresar' }).click()
      await expect(page).toHaveURL('/')
      await expect(page.getByRole('heading', { name: 'Mis hijos' })).toBeVisible()
      const siblingId = randomUUID()
      await db.insert(patient).values({ id: siblingId, name: `Hermano ${siblingId.slice(0, 8)}`, birthDate: '2024-01-01', sex: 'MALE', createdBy: assistantId })
      await db.insert(guardianGrant).values({ patientId: siblingId, guardianId: link!.guardianId, contactEmail: email, proof: 'Identificación presencial verificada', verifiedBy: assistantId, status: 'ACTIVE' })
      await page.reload()
      await expect(page.getByRole('link', { name: 'Ver todas' })).toHaveCount(2)
      await expect(page.getByText(`Hermano ${siblingId.slice(0, 8)}`)).toBeVisible()
      await expect(page.getByText('Conversar en consulta')).toBeVisible()
      await expect(page.getByText('HIDDEN_ADVICE')).toHaveCount(0)
      await page.getByRole('link', { name: 'Ver todas' }).first().click()
      await expect(page.getByRole('heading', { name: `Indicaciones de Niña ${ownId.slice(0, 8)}` })).toBeVisible()
      await expect(page.getByText('Conversar en consulta')).toBeVisible()
      await expect(page.getByText('Peso: 9,00 kg')).toBeVisible()
      expect(await page.locator('body').innerText()).not.toMatch(/DO_NOT_EXPOSE|Z [−+0-9]/)
      const ownApi = await page.request.get(`/api/hijos/${ownId}`)
      expect(ownApi.status()).toBe(200)
      expect(ownApi.headers()['cache-control']).toContain('no-store')
      expect(await ownApi.text()).not.toMatch(/DO_NOT_EXPOSE_NOTE|DO_NOT_EXPOSE_TREND|HIDDEN_ADVICE|PRIVATE_FEBRUARY|results|percentile|"z"|bmi/)
      const homeApi = await page.request.get('/api/hijos')
      expect(await homeApi.text()).not.toMatch(/DO_NOT_EXPOSE_NOTE|DO_NOT_EXPOSE_TREND|HIDDEN_ADVICE|PRIVATE_FEBRUARY|results|percentile|"z"|bmi/)
      const ownSsr = await page.request.get(`/hijos/${ownId}`)
      expect(ownSsr.headers()['cache-control']).toContain('no-store')
      expect(await ownSsr.text()).not.toMatch(/DO_NOT_EXPOSE_NOTE|DO_NOT_EXPOSE_TREND|HIDDEN_ADVICE|PRIVATE_FEBRUARY|percentile|puntuación Z|rango esperado/)
      const homeSsr = await page.request.get('/')
      expect(await homeSsr.text()).not.toMatch(/DO_NOT_EXPOSE_NOTE|HIDDEN_ADVICE|PRIVATE_FEBRUARY|percentile|puntuación Z|rango esperado/)
      const response = await page.request.get(`/api/hijos/${otherId}`)
      expect(response.status()).toBe(404)
      expect(await response.text()).not.toContain('Otra ')
      const ssr = await page.request.get(`/hijos/${otherId}`)
      expect(await ssr.text()).not.toContain('Otra ')
      await db.update(guardianGrant).set({ status: 'REVOKED', revokedAt: new Date() }).where(eq(guardianGrant.patientId, ownId))
      expect((await page.request.get(`/api/hijos/${ownId}`)).status()).toBe(404)
      await page.reload()
      await expect(page.getByText('No se pudo consultar esta información')).toBeVisible()
      expect(await page.locator('body').innerText()).not.toContain('Conversar en consulta')
      await page.context().clearCookies()
    }
  })
})
