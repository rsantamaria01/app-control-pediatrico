import { expect, test } from '@playwright/test'
import { hashPassword } from 'better-auth/crypto'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Pool } from 'pg'
import { account, guardianGrant, patient, user, userRole } from '../../server/db/schema'

const enabled = process.env.AUTH_E2E === '1' && process.env.CLINICAL_E2E === '1' && process.env.CLINICAL_E2E_DATABASE_URL === process.env.TEST_DATABASE_URL
const url = process.env.TEST_DATABASE_URL

test.describe('booking by role and phone', () => {
  test.skip(!enabled, 'Requires disposable clinical E2E database')
  let pool: Pool
  test.beforeAll(async () => {
    if (!url || !/^\/pediatrico_booking_e2e_[a-f0-9]{12}_test$/.test(new URL(url).pathname) || url === process.env.DATABASE_URL) throw new Error('Dedicated disposable E2E DB required')
    pool = new Pool({ connectionString: url })
    await migrate(drizzle(pool), { migrationsFolder: './server/db/migrations' })
  })
  test.afterAll(async () => pool?.end())

  test('guest, parent and staff use pending approval without leaking another family or granting portal access', async ({ browser }) => {
    test.setTimeout(120_000)
    const db = drizzle(pool)
    const doctorId = crypto.randomUUID()
    const assistantId = crypto.randomUUID()
    const parentId = crypto.randomUUID()
    const otherId = crypto.randomUUID()
    const childId = crypto.randomUUID()
    const secondChildId = crypto.randomUUID()
    const suffix = crypto.randomUUID().slice(0, 8)
    const users = [
      { id: doctorId, role: 'DOCTOR', username: `booking-doctor-${suffix}` },
      { id: assistantId, role: 'ASSISTANT', username: `booking-staff-${suffix}` },
      { id: parentId, role: 'PATIENT', username: `booking-family-${suffix}` },
      { id: otherId, role: 'PATIENT', username: `booking-other-${suffix}` }
    ] as const
    for (const entry of users) {
      await db.insert(user).values({ id: entry.id, name: entry.username, email: `${entry.username}@example.test`, username: entry.username })
      await db.insert(userRole).values({ userId: entry.id, role: entry.role })
      await db.insert(account).values({ id: crypto.randomUUID(), userId: entry.id, accountId: entry.id, providerId: 'credential', password: await hashPassword('long secure password') })
    }
    for (const [id, guardian] of [[childId, parentId], [secondChildId, otherId]]) {
      await db.insert(patient).values({ id, name: id === childId ? 'Luna Prueba' : 'Otra Familia', birthDate: '2024-01-01', sex: 'FEMALE', createdBy: doctorId })
      await db.insert(guardianGrant).values({ patientId: id!, guardianId: guardian!, contactEmail: `${users.find(entry => entry.id === guardian)!.username}@example.test`, proof: 'Identidad verificada presencialmente', verifiedBy: doctorId, status: 'ACTIVE' })
    }
    const monday = new Date()
    monday.setUTCDate(monday.getUTCDate() + (8 - monday.getUTCDay()) % 7 + 2800 + Math.floor(Math.random() * 100) * 7)
    const date = monday.toISOString().slice(0, 10)
    const guest = await browser.newContext({ viewport: { width: 375, height: 812 } })
    const page = await guest.newPage()
    try {
      await page.goto('/reservar')
      await page.waitForLoadState('networkidle')
      await expect(page.getByRole('heading', { name: 'Reservar primera cita' })).toBeVisible()
      expect((await guest.request.get('/api/citas')).status()).toBe(401)
      expect((await guest.request.get('/api/agenda/solicitudes')).status()).toBe(401)
      await page.getByRole('main').getByLabel('Fecha').fill(date)
      await expect(page.getByText('No hay horarios libres este día.')).toBeVisible()
      const signIn = async (username: string) => {
        await page.goto('/acceso')
        await page.waitForLoadState('networkidle')
        await page.getByRole('textbox', { name: 'Usuario' }).fill(username)
        await page.getByLabel('Contraseña').fill('long secure password')
        await page.getByRole('button', { name: 'Ingresar' }).click()
        await expect(page).toHaveURL('/')
      }
      await signIn(users[0].username)
      const settings = await guest.request.put('/api/agenda/horarios', { data: { days: [{ weekday: 1, open: '09:00', close: '10:00' }], durationMinutes: 30, blocked: [] } })
      expect(settings.status()).toBe(200)
      await guest.clearCookies()
      await page.goto('/reservar')
      await page.waitForLoadState('networkidle')
      await page.getByRole('main').getByLabel('Fecha').fill(date)
      await expect(page.getByText('09:00')).toBeVisible()
      await page.getByText('09:00').click()
      await page.getByRole('button', { name: 'Continuar' }).click()
      await page.getByRole('textbox', { name: 'Nombres y apellidos del niño/a' }).fill('Invitada Prueba')
      await page.getByLabel('Fecha de nacimiento').fill('2024-01-01')
      await page.getByLabel('Femenino').check()
      await page.getByRole('textbox', { name: 'Nombre del representante' }).fill('Familia Invitada')
      await page.getByRole('textbox', { name: 'Parentesco' }).fill('Madre')
      await page.getByRole('textbox', { name: 'Correo electrónico' }).fill(`booking-${suffix}@example.test`)
      await page.getByRole('textbox', { name: 'Teléfono / WhatsApp' }).fill('0991234567')
      await page.getByRole('button', { name: 'Continuar' }).click()
      await page.getByRole('checkbox').check()
      await page.getByRole('button', { name: 'Verificar correo' }).click()
      await expect(page.getByText('No fue posible iniciar la verificación')).toBeVisible()
      expect((await guest.request.get('/api/hijos')).status()).toBe(401)
      await signIn(users[2].username)
      await page.goto('/citas')
      await page.waitForLoadState('networkidle')
      await expect(page.getByRole('heading', { name: 'Citas', exact: true })).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
      expect((await guest.request.post('/api/citas', { data: { patientId: secondChildId, date, time: '09:30', consent: true, consentVersion: 'DRAFT-2026-11' } })).status()).toBe(404)
      await page.getByLabel('¿Para quién?').selectOption(childId)
      await page.getByLabel('Fecha').fill(date)
      await expect(page.getByText('09:30')).toBeVisible()
      await page.getByText('09:30').click()
      await page.getByRole('checkbox').check()
      await page.getByRole('button', { name: 'Enviar solicitud' }).click()
      await expect(page.getByText('Pendiente de aprobación', { exact: true })).toBeVisible()
      expect((await guest.request.get('/api/agenda/solicitudes')).status()).toBe(403)
      await guest.clearCookies()
      await signIn(users[3].username)
      expect(await (await guest.request.get('/api/citas')).text()).not.toContain('Luna Prueba')
      await guest.clearCookies()
      await signIn(users[1].username)
      await page.goto('/agenda/solicitudes')
      await page.waitForLoadState('networkidle')
      await expect(page.getByText('Luna Prueba')).toBeVisible()
      expect(await page.content()).not.toMatch(/birthDate|patientId|privateNote|weightKg/)
      await page.getByRole('listitem').filter({ hasText: 'Luna Prueba' }).getByRole('button', { name: 'Aprobar' }).click()
      await expect(page.getByRole('status')).toContainText('Cita aprobada')
      expect((await guest.request.get('/api/pacientes')).status()).toBe(403)
      await guest.clearCookies()
      await signIn(users[2].username)
      await page.goto('/citas')
      await page.waitForLoadState('networkidle')
      await expect(page.getByText('Aprobada')).toBeVisible()
    } finally {
      await guest.close()
    }
  })
})
