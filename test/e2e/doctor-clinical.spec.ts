import { expect, test } from '@playwright/test'
import { drizzle } from 'drizzle-orm/node-postgres'
import { and, eq } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { hashPassword } from 'better-auth/crypto'
import { Pool } from 'pg'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { inspectVisual, inspectCanvas } from './visual-evidence'
import manifest from '../../scripts/who-2006-manifest.json' with { type: 'json' }
import { importWhoRelease, parseWhoWorkbook } from '../../server/services/who-import'
import type { VerifiedSource } from '../../shared/types/who'
import type { Gender } from '../../shared/utils/enums'
import { WhoIndicator } from '../../shared/utils/enums'
import { account, auditEvent, guardianGrant, patient, patientContactIntake, user, userRole, visit } from '../../server/db/schema'

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
    const initialVisit = await doctorContext.request.post(`/api/pacientes/${patientId}/visitas`, { data: { requestId: crypto.randomUUID(), measuredAt: '2025-01-01T12:00:00.000Z', weightKg: 9, lengthHeightCm: 75, position: 'RECUMBENT', headCircumferenceCm: 45, privateNote: 'PROHIBIDO COMPARTIR' } })
    expect(initialVisit.status()).toBe(200)
    const visitId = (await initialVisit.json()).id as string
    const doctorGrowth = await doctorContext.request.get(`/api/pacientes/${patientId}/crecimiento`)
    expect(doctorGrowth.status()).toBe(200)
    const doctorCharts = await doctorGrowth.json()
    expect(doctorCharts.charts.WEIGHT_FOR_AGE.curves).toHaveLength(7)
    expect(doctorCharts.charts.WEIGHT_FOR_AGE.curves.map((curve: { label: string }) => curve.label)).toEqual(['−3', '−2', '−1', '0', '+1', '+2', '+3'])
    expect(doctorCharts.charts.WEIGHT_FOR_AGE.points).toHaveLength(1)
    await doctorPage.goto(`/pacientes/${patientId}`)
    await expect(doctorPage.getByRole('heading', { name: 'Curvas de crecimiento OMS' })).toBeVisible()
    const growthSection = doctorPage.getByRole('region', { name: 'Curvas de crecimiento' })
    await expect(growthSection.getByRole('group', { name: 'Indicador de crecimiento' }).getByRole('button', { name: 'Peso para la edad' })).toHaveAttribute('aria-pressed', 'true')
    await expect(growthSection.getByRole('group', { name: 'Rango del gráfico' }).getByRole('button', { name: 'Todo' })).toHaveAttribute('aria-pressed', 'true')
    await expect(growthSection.getByRole('group', { name: 'Vista de crecimiento' }).getByRole('button', { name: 'Gráfico' })).toHaveAttribute('aria-pressed', 'true')
    await expect(doctorPage.getByRole('table', { name: 'Mediciones · Peso para la edad' })).toBeVisible()
    await inspectCanvas(doctorPage, 'section[aria-label="Curvas de crecimiento"]')
    const doctorColors = await doctorPage.locator('section[aria-label="Curvas de crecimiento"] canvas').first().evaluate((element) => {
      const canvas = element as HTMLCanvasElement
      const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
      let blue = 0
      let orange = 0
      for (let i = 0; i < data.length; i += 4) {
        if (data[i]! < 80 && data[i + 1]! < 140 && data[i + 2]! > 160 && data[i + 3]! > 100) blue++
        if (data[i]! > 140 && data[i + 1]! < 130 && data[i + 2]! < 120 && data[i + 3]! > 100) orange++
      }
      return { blue, orange }
    })
    expect(doctorColors.blue, JSON.stringify(doctorColors)).toBeGreaterThan(20)
    expect(doctorColors.orange, JSON.stringify(doctorColors)).toBeGreaterThan(20)
    await growthSection.getByRole('group', { name: 'Rango del gráfico' }).getByRole('button', { name: '6 m' }).click()
    await expect(growthSection.getByRole('group', { name: 'Rango del gráfico' }).getByRole('button', { name: '6 m' })).toHaveAttribute('aria-pressed', 'true')
    await growthSection.getByRole('button', { name: 'Restablecer zoom' }).click()
    await growthSection.getByRole('group', { name: 'Vista de crecimiento' }).getByRole('button', { name: 'Tabla' }).focus()
    await doctorPage.keyboard.press('Enter')
    await expect(growthSection.getByRole('group', { name: 'Vista de crecimiento' }).getByRole('button', { name: 'Tabla' })).toHaveAttribute('aria-pressed', 'true')
    await expect(doctorPage.getByRole('table', { name: 'Mediciones y referencias de crecimiento' })).toBeVisible()
    await expect(doctorPage.getByRole('table', { name: 'Mediciones · Peso para la edad' })).toBeVisible()
    await expect(doctorPage.getByRole('table', { name: 'Mediciones · Peso para la edad' })).toContainText('Edad (base OMS si disponible)')
    await doctorPage.getByRole('table', { name: 'Mediciones y referencias de crecimiento' }).locator('tr[tabindex="0"]').first().focus()
    await expect(doctorPage.getByRole('table', { name: 'Mediciones y referencias de crecimiento' }).locator('tr[tabindex="0"]').first()).toBeFocused()
    await expect(doctorPage.getByRole('table', { name: 'Mediciones y referencias de crecimiento' })).toContainText(/Z [−+]\d+,\d{2} · percentil/)
    const recalculated = await doctorContext.request.post(`/api/pacientes/${patientId}/visitas/${visitId}/recalcular`, { data: { requestId: crypto.randomUUID() } })
    expect(recalculated.status()).toBe(200)
    const recalculatedBody = await recalculated.text()
    expect(recalculatedBody).toContain('parentResultId')
    expect(recalculatedBody).not.toContain('PROHIBIDO COMPARTIR')
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
      await expect(page).toHaveURL(role === 'ADMIN' ? '/admin/inicio' : role === 'ASSISTANT' ? '/agenda' : '/')
      for (const path of ['/api/pacientes', `/api/pacientes/${patientId}`, `/api/pacientes/${patientId}/identidad`]) {
        const response = await context.request.get(path)
        expect(response.status()).toBe(403)
        expect(await response.text()).not.toContain(secret)
      }
      expect((await context.request.post(`/api/pacientes/${patientId}/visitas`, { data: {} })).status()).toBe(403)
      const recalculation = await context.request.post(`/api/pacientes/${patientId}/visitas/${visitId}/recalcular`, { data: { requestId: crypto.randomUUID() } })
      expect(recalculation.status()).toBe(403)
      expect(await recalculation.text()).not.toContain('PROHIBIDO COMPARTIR')
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

  test('quick create confirms provisional matches and searches accent-insensitively on phones and desktop', async ({ page }) => {
    const db = drizzle(pool)
    const doctorId = crypto.randomUUID()
    const username = `quick-${doctorId.slice(0, 8)}`
    await db.insert(user).values({ id: doctorId, name: 'Doctora', email: `${doctorId}@example.test`, username })
    await db.insert(userRole).values({ userId: doctorId, role: 'DOCTOR' })
    await db.insert(account).values({ id: crypto.randomUUID(), userId: doctorId, accountId: doctorId, providerId: 'credential', password: await hashPassword('quick clinical password') })
    await page.goto('/acceso')
    await page.waitForLoadState('networkidle')
    await page.getByRole('textbox', { name: 'Usuario' }).fill(username)
    await page.getByLabel('Contraseña').fill('quick clinical password')
    await page.getByRole('button', { name: 'Ingresar' }).click()
    await expect(page).toHaveURL('/')
    const fill = async (given: string, nationalId: string, phone: string, submit = true) => {
      await page.goto('/pacientes/nuevo')
      await page.waitForLoadState('networkidle')
      await page.getByRole('textbox', { name: /^Nombres/ }).fill(given)
      await page.getByRole('textbox', { name: /^Apellidos/ }).fill('Pérez')
      await page.getByLabel('Fecha de nacimiento').fill('2024-03-01')
      if (nationalId) await page.getByRole('textbox', { name: 'Cédula / NUI' }).fill(nationalId)
      await page.getByRole('textbox', { name: 'Nombre completo' }).fill('Representante verificado')
      await page.getByRole('textbox', { name: 'Parentesco' }).fill('Madre')
      await page.getByRole('textbox', { name: 'Teléfono / WhatsApp' }).fill(phone)
      await page.getByRole('button', { name: 'Verificar representante' }).click()
      await expect(page.getByText('Sin cuenta previa').or(page.getByText(/Cuenta existente:/)).first()).toBeVisible()
      if (await page.getByText(/Cuenta existente:/).count()) {
        await expect(page.getByText(/Cuenta existente:/)).toBeVisible()
        await page.getByRole('checkbox', { name: 'Confirmo que es la misma persona' }).check()
      }
      await page.getByRole('textbox', { name: 'Cómo verificó el vínculo' }).fill('Documento verificado presencialmente')
      if (!submit) return ''
      await page.getByRole('button', { name: 'Crear paciente' }).filter({ visible: true }).click()
      await expect(page.getByRole('heading', { name: `${given} Pérez` })).toBeVisible()
      return page.url().split('/').at(-1)!
    }
    for (const width of [375, 1440]) {
      await page.setViewportSize({ width, height: 850 })
      const unique = String(Math.floor(Math.random() * 1e8)).padStart(8, '0')
      const given = `José${unique}`
      const firstId = await fill(given, '', `9${unique}`)
      await page.getByRole('navigation', { name: 'Secciones del paciente' }).getByRole('button', { name: 'Acceso familiar' }).click()
      await expect(page.getByText('Sin invitar').filter({ visible: true }).first()).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
      await fill(given, '', `9${unique}`, false)
      await page.getByRole('button', { name: 'Crear paciente' }).filter({ visible: true }).click()
      await expect(page.getByText('Posibles pacientes existentes')).toBeVisible()
      await expect(page.getByRole('link', { name: `Abrir ficha de ${given} Pérez` })).toHaveAttribute('href', `/pacientes/${firstId}`)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
      await page.getByRole('checkbox', { name: /He revisado las coincidencias/ }).check()
      await page.getByRole('button', { name: 'Crear paciente' }).filter({ visible: true }).click()
      await expect(page.getByRole('heading', { name: `${given} Pérez` })).toBeVisible()
      expect(page.url().split('/').at(-1)).not.toBe(firstId)
      await page.goto('/pacientes')
      await page.waitForLoadState('networkidle')
      await page.getByRole('searchbox', { name: 'Buscar por nombre o identificación' }).fill(`jose${unique}`)
      await expect(page.getByRole('link', { name: new RegExp(given, 'i') }).first()).toBeVisible()
      await page.getByRole('searchbox', { name: 'Buscar por nombre o identificación' }).fill('sin-coincidencia-ninguna')
      await expect(page.getByRole('link', { name: new RegExp(given, 'i') })).toHaveCount(0)
      await page.getByRole('searchbox', { name: 'Buscar por nombre o identificación' }).fill(`jose${unique}`)
      await expect(page.getByRole('link', { name: new RegExp(given, 'i') }).first()).toBeVisible()
      const rows = await page.locator('main li a[href^="/pacientes/"]').allInnerTexts()
      expect(rows.length).toBe(2)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
    }
  })

  test('post-insert contact failure remains recoverable after reload and cannot be exposed to assistants', async ({ page }) => {
    const db = drizzle(pool)
    const doctorId = crypto.randomUUID()
    const assistantId = crypto.randomUUID()
    const username = `recovery-${doctorId.slice(0, 8)}`
    await db.insert(user).values({ id: doctorId, name: 'Doctora', email: `${doctorId}@example.test`, username })
    await db.insert(userRole).values({ userId: doctorId, role: 'DOCTOR' })
    await db.insert(account).values({ id: crypto.randomUUID(), userId: doctorId, accountId: doctorId, providerId: 'credential', password: await hashPassword('recovery clinical password') })
    await db.insert(user).values({ id: assistantId, name: 'Asistente', email: `${assistantId}@example.test`, username: `assistant-${assistantId.slice(0, 8)}` })
    await db.insert(userRole).values({ userId: assistantId, role: 'ASSISTANT' })
    await db.insert(account).values({ id: crypto.randomUUID(), userId: assistantId, accountId: assistantId, providerId: 'credential', password: await hashPassword('assistant recovery password') })
    await page.goto('/acceso')
    await page.waitForLoadState('networkidle')
    await page.getByRole('textbox', { name: 'Usuario' }).fill(username)
    await page.getByLabel('Contraseña').fill('recovery clinical password')
    await page.getByRole('button', { name: 'Ingresar' }).click()
    await expect(page).toHaveURL('/')
    const phone = `09${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`
    const family = `Recuperación${doctorId.slice(0, 8)}`
    const created = await page.request.post('/api/pacientes/rapido', { data: { givenNames: 'Paciente', surnames: family, birthDate: '2024-01-01', sex: 'FEMALE', contacts: [
      { name: 'Primer contacto', relationship: 'Padre', phone, email: '', proof: 'Identidad confirmada presencialmente', invite: false },
      { name: 'Contacto Sin Vincular', relationship: 'Madre', phone, email: '', proof: 'Identidad confirmada presencialmente', invite: false }
    ] } })
    expect(created.status()).toBe(200)
    const result = await created.json()
    expect(result.contacts.map((contact: { status: string }) => contact.status)).toEqual(['UNINVITED', 'LINK_FAILED'])
    const childId = result.patient.id as string
    await page.goto(`/pacientes/${childId}`)
    await page.waitForLoadState('networkidle')
    await page.getByRole('navigation', { name: 'Secciones del paciente' }).getByRole('button', { name: 'Acceso familiar' }).click()
    await expect(page.getByRole('navigation', { name: 'Secciones del paciente' }).getByRole('button', { name: 'Acceso familiar' })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByText('Contacto Sin Vincular · Madre')).toBeVisible()
    await page.reload()
    await page.waitForLoadState('networkidle')
    await page.getByRole('navigation', { name: 'Secciones del paciente' }).getByRole('button', { name: 'Acceso familiar' }).click()
    await expect(page.getByRole('navigation', { name: 'Secciones del paciente' }).getByRole('button', { name: 'Acceso familiar' })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByText('Contacto Sin Vincular · Madre')).toBeVisible()
    const response = await page.request.get(`/api/pacientes/${childId}/contactos-pendientes`)
    expect(response.status()).toBe(200)
    const pending = await response.json()
    expect(pending).toEqual([expect.objectContaining({ phone, name: 'Contacto Sin Vincular' })])
    const contactId = pending[0].id as string
    await page.getByRole('button', { name: /Verificar identidad de Contacto Sin Vincular/ }).click()
    await expect(page.getByText(/Cuenta existente:/)).toBeVisible()
    await page.getByRole('checkbox', { name: 'Confirmo que es la misma persona' }).check()
    await page.getByRole('button', { name: /Reintentar vínculo de Contacto Sin Vincular/ }).click()
    await expect(page.getByText('Contacto Sin Vincular · Madre')).toHaveCount(0)
    expect((await db.select().from(patientContactIntake).where(eq(patientContactIntake.id, contactId)))[0]?.status).toBe('LINKED')
    const assistantContext = await page.context().browser()!.newContext()
    const assistantPage = await assistantContext.newPage()
    await assistantPage.goto('/acceso')
    await assistantPage.waitForLoadState('networkidle')
    expect((await assistantPage.request.get(`/api/pacientes/${childId}/contactos-pendientes`)).status()).toBe(401)
    await assistantPage.getByRole('textbox', { name: 'Usuario' }).fill(`assistant-${assistantId.slice(0, 8)}`)
    await assistantPage.getByLabel('Contraseña').fill('assistant recovery password')
    await assistantPage.getByRole('button', { name: 'Ingresar' }).click()
    await expect(assistantPage).toHaveURL('/agenda')
    const denied = await assistantPage.request.get(`/api/pacientes/${childId}/contactos-pendientes`)
    expect(denied.status()).toBe(403)
    expect(await denied.text()).not.toContain('Contacto Sin Vincular')
    await assistantContext.close()
  })

  test('doctor clears stale email on pending contact and recovers by verified phone without inviting the wrong account', async ({ page }) => {
    const db = drizzle(pool)
    const doctorId = crypto.randomUUID()
    const username = `clear-email-${doctorId.slice(0, 8)}`
    const email = `${crypto.randomUUID()}@example.test`
    const phone = `09${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`
    await db.insert(user).values({ id: doctorId, name: 'Doctora', email: `${doctorId}@example.test`, username })
    await db.insert(userRole).values({ userId: doctorId, role: 'DOCTOR' })
    await db.insert(account).values({ id: crypto.randomUUID(), userId: doctorId, accountId: doctorId, providerId: 'credential', password: await hashPassword('clinical phone recovery') })
    const ineligibleId = crypto.randomUUID()
    await db.insert(user).values({ id: ineligibleId, name: 'Cuenta ajena', email })
    await db.insert(userRole).values({ userId: ineligibleId, role: 'ASSISTANT' })
    const childId = crypto.randomUUID()
    await db.insert(patient).values({ id: childId, name: 'Paciente con correo erróneo', birthDate: '2024-01-01', sex: 'FEMALE', createdBy: doctorId })
    const intakeId = crypto.randomUUID()
    await db.insert(patientContactIntake).values({ id: intakeId, patientId: childId, position: 0, name: 'Familia correcta', relationship: 'Madre', phone, email, proof: 'Identidad verificada presencialmente', invite: true, createdBy: doctorId })
    await page.goto('/acceso')
    await page.waitForLoadState('networkidle')
    await page.getByRole('textbox', { name: 'Usuario' }).fill(username)
    await page.getByLabel('Contraseña').fill('clinical phone recovery')
    await page.getByRole('button', { name: 'Ingresar' }).click()
    await expect(page).toHaveURL('/')
    await page.goto(`/pacientes/${childId}`)
    await page.waitForLoadState('networkidle')
    await page.getByRole('navigation', { name: 'Secciones del paciente' }).getByRole('button', { name: 'Acceso familiar' }).click()
    await page.getByRole('textbox', { name: 'Correo del contacto' }).fill('')
    await page.getByRole('textbox', { name: 'Cómo verificó la corrección' }).fill('Teléfono y vínculo verificados de nuevo')
    await page.getByRole('button', { name: 'Verificar identidad de Familia correcta' }).click()
    await expect(page.getByText('Sin cuenta previa')).toBeVisible()
    await page.getByRole('button', { name: 'Reintentar vínculo de Familia correcta' }).click()
    await expect(page.getByText('Familia correcta')).toHaveCount(0)
    const [grant] = await db.select().from(guardianGrant).where(eq(guardianGrant.patientId, childId))
    expect(grant?.guardianId).not.toBe(ineligibleId)
    const [intake] = await db.select().from(patientContactIntake).where(eq(patientContactIntake.id, intakeId))
    expect(intake).toMatchObject({ email: null, invite: false, status: 'LINKED' })
  })

  test('perinatal editor hydrates a 36-month preterm child and preserves correction when editing only notes or birth weight', async ({ page }) => {
    const db = drizzle(pool)
    const doctorId = crypto.randomUUID()
    const username = `history-${doctorId.slice(0, 8)}`
    await db.insert(user).values({ id: doctorId, name: 'Doctora', email: `${doctorId}@example.test`, username })
    await db.insert(userRole).values({ userId: doctorId, role: 'DOCTOR' })
    await db.insert(account).values({ id: crypto.randomUUID(), userId: doctorId, accountId: doctorId, providerId: 'credential', password: await hashPassword('perinatal clinical password') })
    const patientId = crypto.randomUUID()
    await db.insert(patient).values({ id: patientId, name: 'Prematura Extrema', birthDate: '2024-01-01', sex: 'FEMALE', gestationDays: 190, correctionUntilMonths: 36, birthWeightKg: '0.85', birthLengthCm: '33', birthHeadCircumferenceCm: '24', perinatalNotes: 'Nota que se debe borrar', createdBy: doctorId })
    await page.goto('/acceso')
    await page.waitForLoadState('networkidle')
    await page.getByRole('textbox', { name: 'Usuario' }).fill(username)
    await page.getByLabel('Contraseña').fill('perinatal clinical password')
    await page.getByRole('button', { name: 'Ingresar' }).click()
    await expect(page).toHaveURL('/')
    await page.goto(`/pacientes/${patientId}`)
    await page.waitForLoadState('networkidle')
    await page.getByRole('navigation', { name: 'Secciones del paciente' }).getByRole('button', { name: 'Antecedentes' }).click()
    await expect(page.getByRole('checkbox', { name: 'Prematuro extremo: corregir hasta 36 meses' })).toBeChecked()
    await expect(page.getByRole('spinbutton', { name: 'Edad gestacional (semanas)' })).toHaveValue('27')
    await expect(page.getByRole('spinbutton', { name: 'Días adicionales' })).toHaveValue('1')
    await expect(page.getByRole('spinbutton', { name: 'Peso al nacer (kg)' })).toHaveValue('0,85')
    await expect(page.getByRole('textbox', { name: 'Notas perinatales' })).toHaveValue('Nota que se debe borrar')
    await page.getByRole('textbox', { name: 'Notas perinatales' }).fill('')
    await page.getByRole('button', { name: 'Guardar antecedentes' }).click()
    await expect.poll(async () => (await page.request.get(`/api/pacientes/${patientId}`).then(response => response.json())).patient).toMatchObject({ gestationDays: 190, correctionUntilMonths: 36, birthWeightKg: 0.85 })
    await expect.poll(async () => (await page.request.get(`/api/pacientes/${patientId}`).then(response => response.json())).patient.perinatalNotes).toBeUndefined()
    await page.getByRole('textbox', { name: 'Notas perinatales' }).fill('Nueva nota')
    await page.getByRole('button', { name: 'Guardar antecedentes' }).click()
    await expect.poll(async () => (await page.request.get(`/api/pacientes/${patientId}`).then(response => response.json())).patient).toMatchObject({ gestationDays: 190, correctionUntilMonths: 36, birthWeightKg: 0.85, perinatalNotes: 'Nueva nota' })
    const submitted = await page.request.post(`/api/pacientes/${patientId}/visitas`, { data: { requestId: crypto.randomUUID(), measuredAt: '2026-07-01T12:00:00.000Z', weightKg: 10, lengthHeightCm: 80, position: 'STANDING', headCircumferenceCm: 46 } })
    expect(submitted.status()).toBe(200)
    const savedVisitId = (await submitted.json()).id as string
    const [savedVisit] = await db.select().from(visit).where(eq(visit.id, savedVisitId))
    expect(savedVisit?.correctionUntilMonths).toBe(36)
  })

  test('duplicate cédula opens the existing chart and does not create another patient', async ({ page }) => {
    const db = drizzle(pool)
    const doctorId = crypto.randomUUID()
    const username = `dedupe-${doctorId.slice(0, 8)}`
    await db.insert(user).values({ id: doctorId, name: 'Doctora', email: `${doctorId}@example.test`, username })
    await db.insert(userRole).values({ userId: doctorId, role: 'DOCTOR' })
    await db.insert(account).values({ id: crypto.randomUUID(), userId: doctorId, accountId: doctorId, providerId: 'credential', password: await hashPassword('dedupe clinical password') })
    await page.goto('/acceso')
    await page.waitForLoadState('networkidle')
    await page.getByRole('textbox', { name: 'Usuario' }).fill(username)
    await page.getByLabel('Contraseña').fill('dedupe clinical password')
    await page.getByRole('button', { name: 'Ingresar' }).click()
    await expect(page).toHaveURL('/')
    const existingId = crypto.randomUUID()
    const nationalId = (() => {
      const base = `171${String(Math.floor(Math.random() * 1e6)).padStart(6, '0')}`
      const sum = [...base].reduce((total, digit, index) => {
        const product = Number(digit) * (index % 2 === 0 ? 2 : 1)
        return total + (product > 9 ? product - 9 : product)
      }, 0)
      return `${base}${(10 - sum % 10) % 10}`
    })()
    await db.insert(patient).values({ id: existingId, name: 'Paciente Ya Registrado', birthDate: '2024-01-01', sex: 'MALE', nationalId, createdBy: doctorId })
    await page.goto('/pacientes/nuevo')
    await page.waitForLoadState('networkidle')
    await page.getByRole('textbox', { name: /^Nombres/ }).fill('Paciente')
    await page.getByRole('textbox', { name: /^Apellidos/ }).fill('Duplicado')
    await page.getByLabel('Fecha de nacimiento').fill('2024-01-01')
    await page.getByRole('textbox', { name: 'Cédula / NUI' }).fill(nationalId)
    const phone = `9${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`
    await page.getByRole('textbox', { name: 'Nombre completo' }).fill('Representante')
    await page.getByRole('textbox', { name: 'Parentesco' }).fill('Madre')
    await page.getByRole('textbox', { name: 'Teléfono / WhatsApp' }).fill(phone)
    await page.getByRole('button', { name: 'Verificar representante' }).click()
    await expect(page.getByText('Sin cuenta previa')).toBeVisible()
    await page.getByRole('textbox', { name: 'Cómo verificó el vínculo' }).fill('Identidad verificada presencialmente')
    await page.getByRole('button', { name: 'Crear paciente' }).filter({ visible: true }).click()
    await expect(page.getByRole('link', { name: 'Abrir ficha existente' })).toHaveAttribute('href', `/pacientes/${existingId}`)
    await page.getByRole('link', { name: 'Abrir ficha existente' }).click()
    await expect(page.getByRole('heading', { name: 'Paciente Ya Registrado' })).toBeVisible()
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
      await page.reload()
      await page.waitForLoadState('networkidle')
      await expect(page.locator('a[href="/pacientes"]').filter({ visible: true }).first()).toBeVisible()
      await page.locator('a[href="/pacientes"]').filter({ visible: true }).first().click()
      const newPatientLink = page.locator('a[href="/pacientes/nuevo"]').filter({ visible: true }).first()
      await expect(newPatientLink).toBeVisible()
      await newPatientLink.click()
      const name = `Paciente ${id.slice(0, 8)}`
      await page.getByRole('textbox', { name: /^Nombres/ }).fill('Paciente')
      await page.getByRole('textbox', { name: /^Apellidos/ }).fill(id.slice(0, 8))
      await page.getByLabel('Fecha de nacimiento').fill('2024-01-01')
      await page.getByRole('textbox', { name: 'Nombre completo' }).fill('Madre de prueba')
      await page.getByRole('textbox', { name: 'Parentesco' }).fill('Madre')
      await page.getByRole('textbox', { name: 'Teléfono / WhatsApp' }).fill(`9${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`)
      await page.getByRole('button', { name: 'Verificar representante' }).click()
      await expect(page.getByText('Sin cuenta previa')).toBeVisible()
      await inspectVisual(page, 'pr15-nuevo', width, 'light')
      await page.emulateMedia({ colorScheme: 'dark' })
      await inspectVisual(page, 'pr15-nuevo', width, 'dark')
      await page.emulateMedia({ colorScheme: 'light' })
      await page.getByRole('textbox', { name: 'Cómo verificó el vínculo' }).fill('Documento verificado presencialmente')
      await expect(page.getByText('Edad gestacional')).toHaveCount(0)
      await expect(page.getByText('Peso al nacer')).toHaveCount(0)
      await page.getByRole('button', { name: 'Crear paciente' }).filter({ visible: true }).click()
      await expect(page.getByRole('heading', { name })).toBeVisible()
      await inspectVisual(page, 'pr15-ficha', width, 'light')
      await page.emulateMedia({ colorScheme: 'dark' })
      await inspectVisual(page, 'pr15-ficha', width, 'dark')
      await page.emulateMedia({ colorScheme: 'light' })
      await page.getByRole('navigation', { name: 'Secciones del paciente' }).getByRole('button', { name: 'Antecedentes' }).click()
      await expect(page.getByText('Edad gestacional sin registrar')).toBeVisible()
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
      await inspectCanvas(page, 'section[aria-label="Curvas de crecimiento"]')
      await inspectVisual(page, 'task8-medico', width, 'light')
      await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' })
      await expect(page.locator('html')).toHaveClass(/dark/)
      await inspectCanvas(page, 'section[aria-label="Curvas de crecimiento"]')
      await inspectVisual(page, 'task8-medico', width, 'dark')
      await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'no-preference' })
      await expect(page.getByRole('table', { name: 'Mediciones' })).not.toContainText('No compartir esta nota')
      await expect(page.getByText(/Z [−+]\d+,\d{2} · percentil/).first()).toBeVisible()
      const detail = await page.request.get(`/api/pacientes/${patientId}`)
      const savedVisitId = (await detail.json()).visits[0].id as string
      await page.getByRole('navigation', { name: 'Secciones del paciente' }).getByRole('button', { name: 'Acceso familiar' }).click()
      await expect(page.getByRole('button', { name: /Dejar de compartir visita/ })).toBeVisible()
      await page.getByRole('button', { name: /Dejar de compartir visita/ }).click()
      await expect(page.getByRole('button', { name: /Compartir visita/ })).toBeVisible()
      expect(await page.request.get(`/api/pacientes/${patientId}/visitas/compartir`).then(response => response.json())).toMatchObject({ [savedVisitId]: false })
      await page.reload()
      await page.waitForLoadState('networkidle')
      await page.getByRole('navigation', { name: 'Secciones del paciente' }).getByRole('button', { name: 'Acceso familiar' }).click()
      await expect(page.getByRole('navigation', { name: 'Secciones del paciente' }).getByRole('button', { name: 'Acceso familiar' })).toHaveAttribute('aria-pressed', 'true')
      await expect(page.getByRole('button', { name: /Compartir visita/ })).toBeVisible()
      const refreshed = await page.request.post(`/api/pacientes/${patientId}/visitas/${savedVisitId}/recalcular`, { data: { requestId: crypto.randomUUID() } })
      expect(refreshed.status()).toBe(200)
      await page.reload()
      await page.waitForLoadState('networkidle')
      await page.getByRole('navigation', { name: 'Secciones del paciente' }).getByRole('button', { name: /Visitas/ }).click()
      await expect(page.getByRole('navigation', { name: 'Secciones del paciente' }).getByRole('button', { name: /Visitas/ })).toHaveAttribute('aria-pressed', 'true')
      await expect(page.getByRole('heading', { name: 'Resultados recalculados · revisión médica' })).toBeVisible()
      await expect(page.getByRole('table', { name: 'Mediciones' })).toContainText('percentil')
      if (width === 375) {
        const layout = await page.evaluate(() => {
          const table = Array.from(document.querySelectorAll('table')).find(element => element.querySelector('caption')?.textContent?.includes('Mediciones'))!
          const scroller = table.parentElement!
          return { viewport: window.innerWidth, document: document.documentElement.scrollWidth, table: table.scrollWidth, scroller: scroller.clientWidth, scrollerContent: scroller.scrollWidth }
        })
        expect(layout.document, JSON.stringify(layout)).toBeLessThanOrEqual(layout.viewport + 1)
        expect(layout.scrollerContent).toBeGreaterThan(layout.scroller)
      }
      await expect(page.locator('a[href="/pacientes"]').filter({ visible: true }).first()).toBeVisible()
      await page.locator('a[href="/pacientes"]').filter({ visible: true }).first().click()
      await page.waitForLoadState('networkidle')
      await page.getByRole('searchbox', { name: 'Buscar por nombre o identificación' }).fill(name.toLowerCase())
      const patientRow = page.getByRole('region', { name: 'Listado de pacientes' }).getByRole('link', { name: new RegExp(name, 'i') })
      await expect(patientRow).toBeVisible()
      await expect(patientRow).toContainText('9,00 kg')
      await inspectVisual(page, 'pr15-pacientes', width, 'light')
      await page.emulateMedia({ colorScheme: 'dark' })
      await inspectVisual(page, 'pr15-pacientes', width, 'dark')
      await page.emulateMedia({ colorScheme: 'light' })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
    })
  }
})
