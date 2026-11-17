import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { and, eq, isNotNull } from 'drizzle-orm'
import { hashPassword } from 'better-auth/crypto'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { account, familyReport, guardianGrant, patient, user, userRole, visit, visitSharing, visitText } from '../../server/db/schema'

const url = process.env.TEST_DATABASE_URL
const enabled = process.env.AUTH_E2E === '1' && process.env.CLINICAL_E2E === '1'

test.describe('doctor-approved family PDF', () => {
  test.skip(!enabled, 'Requires AUTH_E2E=1 CLINICAL_E2E=1 and disposable DB')
  let pool: Pool
  let db: ReturnType<typeof drizzle>

  test.beforeAll(async () => {
    if (!url || new URL(url).pathname !== '/pediatrico_auth_slice2_test' || url === process.env.DATABASE_URL || url !== process.env.CLINICAL_E2E_DATABASE_URL) throw new Error('Dedicated disposable E2E DB required')
    pool = new Pool({ connectionString: url })
    db = drizzle(pool)
    await migrate(db, { migrationsFolder: './server/db/migrations' })
  })
  test.afterAll(async () => {
    await pool?.end()
  })

  for (const width of [375, 1440]) {
    test(`doctor approves then guardian downloads only current shared report at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 812 })
      const doctorId = randomUUID()
      const guardianId = randomUUID()
      const childId = randomUUID()
      const visitId = randomUUID()
      const username = `doc-${doctorId.slice(0, 8)}`
      const guardianName = `family-${guardianId.slice(0, 8)}`
      const password = 'unique clinical passphrase'
      await db.insert(user).values([
        { id: doctorId, name: 'Doctora', email: `${doctorId}@example.test`, username },
        { id: guardianId, name: 'Familia', email: `${guardianId}@example.test`, username: guardianName }
      ])
      await db.insert(userRole).values([{ userId: doctorId, role: 'DOCTOR' }, { userId: guardianId, role: 'PATIENT' }])
      await db.insert(account).values([
        { id: randomUUID(), userId: doctorId, accountId: doctorId, providerId: 'credential', password: await hashPassword(password) },
        { id: randomUUID(), userId: guardianId, accountId: guardianId, providerId: 'credential', password: await hashPassword(password) }
      ])
      await db.insert(patient).values({ id: childId, name: 'Niña con informe', birthDate: '2024-01-01', sex: 'FEMALE', createdBy: doctorId })
      await db.insert(guardianGrant).values({ patientId: childId, guardianId, contactEmail: `${guardianId}@example.test`, proof: 'Verificado en consulta', verifiedBy: doctorId, status: 'ACTIVE' })
      await db.insert(visit).values({ id: visitId, patientId: childId, requestId: randomUUID(), requestDigest: 'fixture', measuredAt: new Date('2025-01-01T12:00:00Z'), weightKg: '9', lengthHeightCm: '75', position: 'RECUMBENT', headCircumferenceCm: '45', bmi: '16', birthDateAtVisit: '2024-01-01', sexAtVisit: 'FEMALE', correctionUntilMonths: 24, authorId: doctorId, shareWithFamily: true })
      await db.insert(visitText).values({ visitId, privateNote: 'PRIVATE_NEVER_SHOW', parentAdvice: 'Control familiar en febrero' })

      async function login(name: string) {
        await page.goto('/acceso')
        await page.waitForLoadState('networkidle')
        await page.getByRole('textbox', { name: 'Usuario' }).fill(name)
        await page.getByLabel('Contraseña').fill(password)
        await page.getByRole('button', { name: 'Ingresar' }).click()
        await expect(page).toHaveURL('/')
      }

      await login(username)
      const legacyId = randomUUID()
      await db.insert(familyReport).values({ id: legacyId, patientId: childId, content: { name: 'Niña con informe', birthDate: '2024-01-01', visits: [{ id: visitId, measuredAt: '2025-01-01T12:00:00.000Z', weightKg: 9, lengthHeightCm: 75, position: 'RECUMBENT', headCircumferenceCm: 45, nextControlAt: null, parentAdvice: 'Control familiar en febrero' }], charts: {}, sources: [] }, version: 1, createdBy: doctorId, approvedBy: doctorId, approvedAt: new Date() })
      await page.goto(`/pacientes/${childId}/informe`)
      await page.waitForLoadState('networkidle')
      await expect(page.getByText('Informe anterior sin PDF descargable')).toBeVisible()
      await expect(page.getByText('Requiere una nueva vista previa y aprobación médica.')).toBeVisible()
      await expect(page.getByRole('heading', { name: 'Informe de crecimiento', exact: true })).toBeVisible()
      const pdfBefore = await page.request.get(`/api/hijos/${childId}/informe`)
      expect(pdfBefore.status()).toBe(403)
      await page.getByRole('button', { name: 'Crear vista previa' }).click()
      await expect(page.getByRole('status')).toContainText('Pendiente de aprobación')
      const previewFrame = page.getByTitle('Documento PDF familiar para revisión antes de aprobar')
      await expect(previewFrame).toBeVisible()
      const previewSrc = await previewFrame.getAttribute('src')
      expect(previewSrc).toContain('/vista-previa')
      const doctorPreview = await page.request.get(previewSrc!)
      expect(doctorPreview.status()).toBe(200)
      const previewBytes = await doctorPreview.body()
      expect(previewBytes.subarray(0, 4).toString()).toBe('%PDF')
      expect((await page.request.get(`/api/pacientes/${childId}/informes/anteriores`)).status()).toBe(200)
      expect(await page.locator('main').innerText()).not.toMatch(/PRIVATE_NEVER_SHOW|percentil|Puntuación Z/)
      const [preview] = await db.select().from(familyReport).where(and(eq(familyReport.patientId, childId), isNotNull(familyReport.pdfBase64)))
      expect(preview?.approvedAt).toBeNull()
      await page.getByRole('button', { name: 'Aprobar este informe para la familia' }).click()
      await expect(page.getByRole('status')).toContainText('Aprobado para la familia')
      await page.context().clearCookies()
      await login(guardianName)
      await page.goto(`/hijos/${childId}/informe`)
      await expect(page.getByRole('region', { name: 'Informes aprobados' })).toBeVisible()
      expect((await page.request.get(`/api/hijos/${childId}/informes/${legacyId}/pdf`)).status()).toBe(404)
      expect((await page.request.get(`/api/hijos/${childId}/informes/${legacyId}`)).status()).toBe(404)
      expect((await page.request.get(`/api/hijos/${childId}/informe`).then(response => response.json())).map((item: { id: string }) => item.id)).not.toContain(legacyId)
      const href = await page.getByRole('region', { name: 'Informes aprobados' }).getByRole('link', { name: 'Ver PDF aprobado' }).getAttribute('href')
      expect(href).toContain(preview!.id)
      const response = await page.request.get(href!)
      expect(response.status()).toBe(200)
      expect(await response.body()).toEqual(previewBytes)
      expect(response.headers()['content-type']).toContain('application/pdf')
      expect(response.headers()['cache-control']).toContain('no-store')
      const pdf = await getDocument({ data: new Uint8Array(await response.body()), useSystemFonts: true }).promise
      let contents = ''
      for (let index = 1; index <= pdf.numPages; index++) contents += (await (await pdf.getPage(index)).getTextContent()).items.map(item => 'str' in item ? item.str : '').join(' ')
      expect(contents).toContain('Control familiar en febrero')
      expect(contents).not.toMatch(/PRIVATE_NEVER_SHOW|percentil|puntuación Z|clasificación|normal|anormal/i)
      const json = await page.request.get(`/api/hijos/${childId}/informes/${preview!.id}`)
      expect(await json.text()).not.toMatch(/PRIVATE_NEVER_SHOW|percentile|classification|"z"|"bmi"/i)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
      await db.insert(visitSharing).values({ visitId, shared: false, changedBy: doctorId })
      expect((await page.request.get(href!)).status()).toBe(404)
      expect((await page.request.get(`/api/hijos/${childId}/informes/${preview!.id}`)).status()).toBe(404)
      await page.reload()
      await expect(page.getByText('No hay informes disponibles')).toBeVisible()
      await db.update(visitSharing).set({ shared: true }).where(eq(visitSharing.visitId, visitId))
      await db.update(guardianGrant).set({ status: 'REVOKED' }).where(eq(guardianGrant.patientId, childId))
      expect((await page.request.get(href!)).status()).toBe(404)
    })
  }
})
