import { expect, test } from '@playwright/test'
import { drizzle } from 'drizzle-orm/node-postgres'
import { and, eq } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { hashPassword } from 'better-auth/crypto'
import { Pool } from 'pg'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import manifest from '../../scripts/who-2006-manifest.json' with { type: 'json' }
import { importWhoRelease, parseWhoWorkbook } from '../../server/services/who-import'
import type { VerifiedSource } from '../../shared/types/who'
import type { Gender } from '../../shared/utils/enums'
import { WhoIndicator } from '../../shared/utils/enums'
import { account, auditEvent, user, userRole } from '../../server/db/schema'

const enabled = process.env.AUTH_E2E === '1' && process.env.CLINICAL_E2E === '1' && process.env.CLINICAL_E2E_DATABASE_URL === process.env.TEST_DATABASE_URL
const url = process.env.TEST_DATABASE_URL

test.describe('doctor clinical journey with isolated auth and WHO database', () => {
  test.skip(!enabled, 'Requires CLINICAL_E2E=1, AUTH_E2E=1 and isolated WHO test database')
  let pool: Pool
  test.beforeAll(async () => {
    if (!url || new URL(url).pathname !== '/pediatrico_auth_slice2_test' || url === process.env.DATABASE_URL || process.env.CLINICAL_E2E_DATABASE_URL !== url) throw new Error('Dedicated disposable clinical E2E DB required')
    pool = new Pool({ connectionString: url })
    await migrate(drizzle(pool), { migrationsFolder: './server/db/migrations' })
    const entries = await Promise.all(manifest.files.map(async (file) => {
      const bytes = await readFile(resolve('/tmp/opencode/who-2006', `${file.name}-expanded.xlsx`))
      const indicator = file.indicator as WhoIndicator
      const isLength = indicator === WhoIndicator.WEIGHT_FOR_LENGTH
      const isHeight = indicator === WhoIndicator.WEIGHT_FOR_HEIGHT
      const source: VerifiedSource = {
        publisher: 'WHO', standard: 'WHO_2006', version: manifest.version, publicationDate: file.publicationDate,
        retrievedAt: manifest.retrievedAt, url: file.url, sha256: file.sha256, bytes,
        indicator, sex: file.sex as Gender, position: isLength ? 'RECUMBENT' : isHeight ? 'STANDING' : null,
        xUnit: isLength || isHeight ? 'CM' : 'DAY', minX: isLength ? 45 : isHeight ? 65 : 0,
        maxX: isLength ? 110 : isHeight ? 120 : 1856, step: isLength || isHeight ? 0.1 : 1
      }
      return { source, rows: await parseWhoWorkbook(source, bytes) }
    }))
    const prior = process.env.DATABASE_URL
    process.env.DATABASE_URL = url
    try {
      await importWhoRelease(entries)
    } finally {
      process.env.DATABASE_URL = prior
    }
  })
  test.afterAll(async () => {
    await pool?.end()
  })

  test('admin, assistant, guardian and guest cannot read or write clinical HTTP or SSR', async ({ browser }) => {
    const db = drizzle(pool)
    const doctorId = crypto.randomUUID()
    const secret = `Paciente Privado ${doctorId.slice(0, 8)}`
    const password = 'long private clinical password'
    const doctorName = `doc-${doctorId.slice(0, 8)}`
    await db.insert(user).values({ id: doctorId, name: 'Doctora', email: `${doctorId}@example.test`, username: doctorName })
    await db.insert(userRole).values({ userId: doctorId, role: 'DOCTOR' })
    await db.insert(account).values({ id: crypto.randomUUID(), accountId: doctorId, userId: doctorId, providerId: 'credential', password: await hashPassword(password) })
    const doctorContext = await browser.newContext()
    const doctorPage = await doctorContext.newPage()
    await doctorPage.goto('/acceso')
    await doctorPage.waitForLoadState('networkidle')
    await doctorPage.getByRole('textbox', { name: 'Usuario' }).fill(doctorName)
    await doctorPage.getByLabel('Contraseña').fill(password)
    await doctorPage.getByRole('button', { name: 'Ingresar' }).click()
    await expect(doctorPage).toHaveURL('/')
    const created = await doctorContext.request.post('/api/pacientes', { data: { name: secret, sex: 'FEMALE', birthDate: '2024-01-01' } })
    expect(created.status()).toBe(200)
    const patientId = (await created.json()).id as string
    await doctorContext.close()
    for (const role of ['ADMIN', 'ASSISTANT', 'PATIENT'] as const) {
      const actorId = crypto.randomUUID()
      const username = `${role.toLowerCase()}-${actorId.slice(0, 8)}`
      await db.insert(user).values({ id: actorId, name: role, email: `${actorId}@example.test`, username })
      await db.insert(userRole).values({ userId: actorId, role })
      await db.insert(account).values({ id: crypto.randomUUID(), accountId: actorId, userId: actorId, providerId: 'credential', password: await hashPassword(password) })
      const context = await browser.newContext()
      const page = await context.newPage()
      await page.goto('/acceso')
      await page.waitForLoadState('networkidle')
      await page.getByRole('textbox', { name: 'Usuario' }).fill(username)
      await page.getByLabel('Contraseña').fill(password)
      await page.getByRole('button', { name: 'Ingresar' }).click()
      await expect(page).toHaveURL('/')
      for (const path of ['/api/pacientes', `/api/pacientes/${patientId}`, `/api/pacientes/${patientId}/identidad`]) {
        const response = await context.request.get(path)
        expect(response.status()).toBe(403)
        expect(await response.text()).not.toContain(secret)
      }
      expect((await context.request.post(`/api/pacientes/${patientId}/visitas`, { data: {} })).status()).toBe(403)
      await page.goto(`/pacientes/${patientId}`)
      await expect(page.getByText(secret)).toHaveCount(0)
      expect(await page.content()).not.toContain(secret)
      expect((await db.select().from(auditEvent).where(and(eq(auditEvent.subjectId, patientId), eq(auditEvent.actorId, actorId)))).filter(event => event.outcome === 'DENIED').length).toBeGreaterThan(0)
      await context.close()
    }
    const guest = await browser.newContext()
    expect((await guest.request.get(`/api/pacientes/${patientId}`)).status()).toBe(401)
    expect((await guest.request.get('/api/pacientes')).status()).toBe(401)
    expect((await db.select().from(auditEvent).where(and(eq(auditEvent.subjectId, patientId), eq(auditEvent.action, 'CLINICAL_READ')))).some(event => event.outcome === 'DENIED' && !event.actorId)).toBe(true)
    await guest.close()
  })

  for (const width of [375, 1024, 1440]) {
    test(`doctor registers a real patient and visit at ${width}px`, async ({ page }) => {
      const db = drizzle(pool)
      const id = crypto.randomUUID()
      const username = `clinical-${id.slice(0, 8)}`
      const password = 'long clinical test password'
      await db.insert(user).values({ id, name: 'Doctora de prueba', email: `${id}@example.test`, username })
      await db.insert(userRole).values({ userId: id, role: 'DOCTOR' })
      await db.insert(account).values({ id: crypto.randomUUID(), userId: id, accountId: id, providerId: 'credential', password: await hashPassword(password) })
      await page.setViewportSize({ width, height: 850 })
      await page.goto('/acceso')
      await page.waitForLoadState('networkidle')
      await page.getByRole('textbox', { name: 'Usuario' }).fill(username)
      await page.getByLabel('Contraseña').fill(password)
      await page.getByRole('button', { name: 'Ingresar' }).click()
      await expect(page).toHaveURL('/')
      await page.getByRole('link', { name: 'Pacientes' }).first().click()
      await page.getByRole('link', { name: 'Nuevo paciente' }).first().click()
      const name = `Paciente ${id.slice(0, 8)}`
      await page.getByRole('textbox', { name: 'Nombre completo' }).fill(name)
      await page.getByLabel('Fecha de nacimiento').fill('2024-01-01')
      await page.getByRole('button', { name: 'Crear paciente' }).click()
      await expect(page.getByRole('heading', { name })).toBeVisible()
      const patientId = new URL(page.url()).pathname.split('/').at(-1)!
      const denied = await page.request.get(`/api/pacientes/${patientId}`, { headers: { cookie: '' } })
      expect(denied.status()).toBe(401)
      expect(JSON.stringify(await denied.json())).not.toContain(name)
      await page.getByRole('link', { name: 'Nueva visita' }).click()
      await page.getByLabel('Fecha y hora').fill('2025-01-01T09:00')
      await page.getByLabel('Peso (kg)').fill('9')
      await page.getByLabel('Longitud o talla (cm)').fill('75')
      await page.getByLabel('Perímetro cefálico (cm)').fill('45')
      await page.getByLabel('Nota privada').fill('No compartir esta nota')
      await page.getByRole('button', { name: 'Guardar visita' }).click()
      await expect(page.getByRole('table', { name: 'Mediciones' })).toContainText('9,00 kg')
      await expect(page.getByRole('table', { name: 'Mediciones' })).not.toContainText('No compartir esta nota')
      await expect(page.getByText(/Z [−+]\d+,\d{2} · percentil/).first()).toBeVisible()
      await expect(page.getByRole('link', { name: 'Pacientes' }).first()).toBeVisible()
      await page.getByRole('link', { name: 'Pacientes' }).first().click()
      await page.getByRole('textbox', { name: 'Buscar por nombre' }).fill(name)
      await expect(page.getByRole('link', { name })).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
    })
  }
})
