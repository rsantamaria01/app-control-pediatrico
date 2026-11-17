import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'
import { hashPassword } from 'better-auth/crypto'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Pool } from 'pg'
import { account, user, userRole } from '../../server/db/schema'

const databaseUrl = process.env.TEST_DATABASE_URL
const enabled = process.env.AUTH_E2E === '1'
const password = 'unique fidelity test passphrase'

const roles = {
  DOCTOR: { destination: '/', desktop: [['Inicio', '/'], ['Pacientes', '/pacientes'], ['Agenda', '/agenda'], ['Avisos', '/avisos'], ['Perfil', '/perfil']], mobile: [['Inicio', '/'], ['Pacientes', '/pacientes'], ['Agenda', '/agenda'], ['Avisos', '/avisos'], ['Perfil', '/perfil']] },
  ASSISTANT: { destination: '/agenda', desktop: [['Agenda', '/agenda'], ['Horarios', '/agenda/horarios'], ['Avisos', '/avisos'], ['Perfil', '/perfil']], mobile: [['Agenda', '/agenda'], ['Horarios', '/agenda/horarios'], ['Avisos', '/avisos'], ['Perfil', '/perfil']] },
  ADMIN: { destination: '/admin/clinica', desktop: [['Clínica', '/admin/clinica'], ['Catálogos', '/admin/catalogos']], mobile: [['Clínica', '/admin/clinica'], ['Catálogos', '/admin/catalogos']] },
  PATIENT: { destination: '/', desktop: [['Inicio', '/'], ['Citas', '/citas'], ['Avisos', '/avisos'], ['Perfil', '/perfil']], mobile: [['Inicio', '/'], ['Citas', '/citas'], ['Avisos', '/avisos'], ['Perfil', '/perfil']] }
} as const

async function expectLinks(page: Page, selector: string, items: readonly (readonly [string, string])[], collapsed = false) {
  const links = page.locator(selector).getByRole('link')
  await expect(links).toHaveCount(items.length)
  for (const [index, [label, href]] of items.entries()) {
    await expect(links.nth(index)).toHaveAttribute('href', href)
    if (!collapsed) await expect(links.nth(index)).toHaveAccessibleName(label)
  }
}

test.describe('board fidelity: public access and role-aware shell', () => {
  test.skip(!enabled, 'Requires AUTH_E2E=1 and dedicated disposable auth database')
  let pool: Pool
  let db: ReturnType<typeof drizzle>

  test.beforeAll(async () => {
    if (!databaseUrl || new URL(databaseUrl).pathname !== '/pediatrico_auth_slice2_test' || databaseUrl === process.env.DATABASE_URL) throw new Error('Dedicated auth test DB required')
    pool = new Pool({ connectionString: databaseUrl })
    db = drizzle(pool)
    await migrate(db, { migrationsFolder: './server/db/migrations' })
  })

  test.afterAll(async () => {
    await pool?.end()
  })

  async function signIn(page: Page, role: keyof typeof roles) {
    const id = randomUUID()
    const username = `fidelity-${id.slice(0, 12)}`
    await db.insert(user).values({ id, email: `${id}@example.test`, name: `Fidelity ${role}`, username })
    await db.insert(userRole).values({ userId: id, role })
    await db.insert(account).values({ id: randomUUID(), userId: id, accountId: id, providerId: 'credential', password: await hashPassword(password) })
    await page.goto('/acceso')
    await page.waitForLoadState('networkidle')
    await page.getByRole('textbox', { name: 'Usuario' }).fill(username)
    await page.getByLabel('Contraseña').fill(password)
    const response = page.waitForResponse(reply => reply.url().includes('/api/auth/sign-in/username'))
    await page.getByRole('button', { name: 'Ingresar' }).click()
    const signInResponse = await response
    expect(signInResponse.status(), await signInResponse.text()).toBe(200)
    await expect(page).toHaveURL(roles[role].destination)
    await expect(page.getByRole('heading', { name: 'Ingresar' })).toHaveCount(0)
  }

  test('desktop public access keeps the two-panel board layout without a global navigation', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/acceso')
    const brand = page.locator('main > section').first()
    const form = page.locator('main > section').nth(1)
    await expect(brand.getByRole('heading', { name: 'El crecimiento de cada niño, claro y a tiempo.' })).toBeVisible()
    await expect(brand.getByRole('img', { name: 'Logo de la clínica' })).toBeVisible()
    await expect(form.getByRole('heading', { name: 'Ingresar' })).toBeVisible()
    await expect(form.getByRole('textbox', { name: 'Usuario' })).toBeVisible()
    await expect(form.getByLabel('Contraseña')).toBeVisible()
    await expect(form.getByRole('link', { name: 'Reservar una primera cita' })).toBeVisible()
    const left = await brand.boundingBox()
    const right = await form.boundingBox()
    expect(left).not.toBeNull()
    expect(right).not.toBeNull()
    expect(left!.x + left!.width).toBeLessThanOrEqual(right!.x + 1)
    expect(left!.width).toBeGreaterThanOrEqual(480)
    expect(right!.width).toBeGreaterThanOrEqual(480)
    await expect(page.getByRole('navigation')).toHaveCount(0)
  })

  test('phone public access has one brand and an accessible username/password form, not a sidebar or tabs', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/acceso')
    await expect(page.locator('main > section').first()).toBeHidden()
    await expect(page.locator('main > section').nth(1).getByRole('img', { name: 'Logo de la clínica' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Ingresar' })).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'Usuario' })).toBeVisible()
    await expect(page.getByLabel('Contraseña')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Ingresar' })).toBeVisible()
    await expect(page.getByRole('navigation')).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  })

  for (const role of Object.keys(roles) as Array<keyof typeof roles>) {
    for (const width of [1440, 1024, 390] as const) {
      test(`${role} at ${width}px shows its shell immediately after sign-in and never the public landing`, async ({ page }) => {
        await page.setViewportSize({ width, height: width === 390 ? 844 : width === 1024 ? 768 : 900 })
        await signIn(page, role)
        if (width === 390) {
          const tabs = page.getByRole('navigation', { name: 'Navegación principal' })
          await expect(tabs).toBeVisible()
          await expect(tabs.getByRole('link')).toHaveCount(roles[role].mobile.length)
          expect(await tabs.getByRole('link').count()).toBeLessThanOrEqual(5)
          await expectLinks(page, 'nav[aria-label="Navegación principal"]', roles[role].mobile)
          if (role === 'ADMIN') await expect(tabs.getByRole('link', { name: /Pacientes|Citas/ })).toHaveCount(0)
          await expect(page.locator('[data-slot="body"] nav[aria-label="Navegación principal"], [data-slot="body"] nav[aria-label="Administración"]')).toBeHidden()
        } else if (role === 'PATIENT') {
          const header = page.locator('header[data-slot="root"]')
          await expect(header).toBeVisible()
          await expect(header.getByRole('img', { name: 'Logo de la clínica' })).toBeVisible()
          await expectLinks(page, 'header[data-slot="root"] nav', roles.PATIENT.desktop)
          await expect(header.getByRole('button', { name: 'Cambiar tema' })).toBeVisible()
          await expect(header.getByRole('button', { name: 'Cerrar sesión' })).toBeVisible()
          await expect(page.getByRole('navigation', { name: 'Navegación principal' })).toBeHidden()
        } else {
          const label = role === 'ADMIN' ? 'Administración' : 'Navegación principal'
          const sidebar = page.getByRole('navigation', { name: label })
          await expect(sidebar).toBeVisible()
          const shell = sidebar.locator('xpath=ancestor::*[@data-slot="body"][1]/..')
          await expect(shell).toBeVisible()
          await expect(shell.locator('[data-slot="header"] img[alt="Logo de la clínica"]')).toBeVisible()
          if (width === 1440) {
            await expect(shell.locator('[data-slot="footer"]')).toContainText(`Fidelity ${role}`)
            await expect(shell.locator('[data-slot="footer"]').getByRole('button', { name: 'Cambiar tema' })).toBeVisible()
          }
          await expectLinks(page, `nav[aria-label="${label}"]`, roles[role].desktop, width === 1024)
          if (role !== 'ADMIN') await expect(page.getByRole('navigation', { name: 'Administración' })).toHaveCount(0)
          else await expect(page.getByRole('navigation', { name: 'Navegación principal' })).toHaveCount(0)
          const title = role === 'DOCTOR' ? 'Inicio' : role === 'ASSISTANT' ? 'Agenda' : 'Clínica'
          const topbar = page.locator('h1[data-slot="title"]').filter({ hasText: title }).locator('xpath=../..')
          await expect(topbar).toBeVisible()
          await expect(topbar.getByRole('heading', { name: title, exact: true })).toBeVisible()
          if (role === 'DOCTOR') {
            if (width === 1440) await expect(topbar.getByRole('textbox', { name: 'Buscar paciente por nombre o cédula' })).toBeVisible()
            await expect(topbar.getByRole('link', { name: 'Avisos' })).toBeVisible()
            await expect(topbar.getByRole('link', { name: 'Nuevo paciente' })).toBeVisible()
          }
          if (role === 'ASSISTANT') await expect(topbar.getByRole('textbox', { name: 'Buscar paciente por nombre o cédula' })).toHaveCount(0)
        }
        await page.goto('/acceso')
        await expect(page).toHaveURL(roles[role].destination)
        await expect(page.getByRole('heading', { name: 'Ingresar' })).toHaveCount(0)
      })
    }
  }
})
