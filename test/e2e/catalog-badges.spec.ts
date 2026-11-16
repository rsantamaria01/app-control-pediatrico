import { expect, test } from '@playwright/test'
import { hashPassword } from 'better-auth/crypto'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Pool } from 'pg'
import { account, catalogItem, catalogRelease, user, userRole } from '../../server/db/schema'

const enabled = process.env.AUTH_E2E === '1' && process.env.CLINICAL_E2E === '1' && process.env.CLINICAL_E2E_DATABASE_URL === process.env.TEST_DATABASE_URL
const url = process.env.TEST_DATABASE_URL

test.describe('preventive catalog admin review', () => {
  test.skip(!enabled, 'Requires disposable clinical E2E database')
  let pool: Pool
  test.beforeAll(async () => {
    if (!url || new URL(url).pathname !== '/pediatrico_auth_slice2_test' || url === process.env.DATABASE_URL) throw new Error('Dedicated disposable E2E DB required')
    pool = new Pool({ connectionString: url })
    await migrate(drizzle(pool), { migrationsFolder: './server/db/migrations' })
  })
  test.afterAll(async () => pool?.end())

  for (const width of [375, 1440]) {
    test(`admin sees draft status per row without horizontal overflow at ${width}px`, async ({ browser }) => {
      const db = drizzle(pool)
      const id = crypto.randomUUID()
      const version = `test-${id}`
      const username = `catalog-${id.slice(0, 8)}`
      const releaseId = crypto.randomUUID()
      await db.insert(catalogRelease).values({ id: releaseId, kind: 'MOTOR', publisher: 'WHO', title: 'Test-only fixture', version, publicationDate: '2006-04-07', retrievedAt: '2026-11-16', url: 'https://cdn.who.int/fixture.pdf', sha256: 'a'.repeat(64) })
      await db.insert(catalogItem).values([{ releaseId, key: 'one', label: 'Test row one', domain: 'GROSS_MOTOR', minAgeMonths: '1', maxAgeMonths: '2', sourcePage: '1' }, { releaseId, key: 'two', label: 'Test row two', domain: 'GROSS_MOTOR', minAgeMonths: '2', maxAgeMonths: '3', sourcePage: '1' }])
      await db.insert(user).values({ id, name: 'Administrador', email: `${id}@example.test`, username })
      await db.insert(userRole).values({ userId: id, role: 'ADMIN' })
      await db.insert(account).values({ id: crypto.randomUUID(), userId: id, accountId: id, providerId: 'credential', password: await hashPassword('long secure password') })
      const context = await browser.newContext({ viewport: { width, height: 900 } })
      const page = await context.newPage()
      await page.goto('/acceso')
      await page.waitForLoadState('networkidle')
      await page.getByRole('textbox', { name: 'Usuario' }).fill(username)
      await page.getByLabel('Contraseña').fill('long secure password')
      await page.getByRole('button', { name: 'Ingresar' }).click()
      await expect(page).toHaveURL('/')
      await page.goto('/admin/catalogos')
      await expect(page.getByRole('heading', { name: 'Catálogos preventivos' })).toBeVisible()
      const section = page.getByRole('region', { name: `Test-only fixture · ${version}` })
      await expect(section.getByText('Borrador · pendiente de revisión pediátrica')).toHaveCount(2)
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1)
      const response = await context.request.get('/api/admin/catalogos/MOTOR')
      expect(response.status()).toBe(200)
      expect((await response.json()).versions.find((item: { id: string }) => item.id === releaseId).entries).toHaveLength(2)
      await context.close()
    })
  }

  test('assistant cannot read catalog API or SSR content', async ({ browser }) => {
    const db = drizzle(pool)
    const id = crypto.randomUUID()
    const username = `catalog-${id.slice(0, 8)}`
    await db.insert(user).values({ id, name: 'Asistente', email: `${id}@example.test`, username })
    await db.insert(userRole).values({ userId: id, role: 'ASSISTANT' })
    await db.insert(account).values({ id: crypto.randomUUID(), userId: id, accountId: id, providerId: 'credential', password: await hashPassword('long secure password') })
    const context = await browser.newContext()
    const page = await context.newPage()
    await page.goto('/acceso')
    await page.waitForLoadState('networkidle')
    await page.getByRole('textbox', { name: 'Usuario' }).fill(username)
    await page.getByLabel('Contraseña').fill('long secure password')
    await page.getByRole('button', { name: 'Ingresar' }).click()
    await expect(page).toHaveURL('/')
    expect((await context.request.get('/api/admin/catalogos/MOTOR')).status()).toBe(403)
    await page.goto('/admin/catalogos')
    expect(await page.content()).not.toContain('Test row one')
    await context.close()
  })
})
