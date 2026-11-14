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

  test('assistant verifies and invites; parent sees only own child at 375 and 1440, revoke removes access', async ({ page }) => {
    for (const width of [375, 1440]) {
      messages.length = 0
      const assistantId = randomUUID()
      const username = `assistant-${assistantId.slice(0, 8)}`
      const ownId = randomUUID()
      const otherId = randomUUID()
      const email = `${randomUUID()}@example.test`
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
      await page.getByRole('textbox', { name: 'Correo del representante' }).fill(email)
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
      expect(link?.status).toBe('PENDING')
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
