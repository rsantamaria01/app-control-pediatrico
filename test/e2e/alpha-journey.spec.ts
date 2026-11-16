import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { CatalogView } from '../../shared/types/catalog'

const enabled = process.env.ALPHA_COMPOSE_E2E === '1'
const email = `family-${randomUUID()}@example.test`
const doctorEmail = `doctor-${randomUUID()}@example.test`
const assistantEmail = `assistant-${randomUUID()}@example.test`
const password = 'unique doctor setup passphrase'

async function pdfText(bytes: Buffer) {
  const pdf = await getDocument({ data: new Uint8Array(bytes), useSystemFonts: true }).promise
  let text = ''
  for (let index = 1; index <= pdf.numPages; index++) text += (await (await pdf.getPage(index)).getTextContent()).items.map(item => 'str' in item ? item.str : '').join(' ')
  return text
}

test('production image journeys from bootstrapped admin through two children and approved family PDF', async ({ browser, request }) => {
  test.skip(!enabled, 'Requires isolated production Compose checkpoint')
  if (enabled) test.setTimeout(120_000)
  const origin = process.env.ALPHA_PUBLIC_ORIGIN
  const adminPassword = process.env.ALPHA_ADMIN_PASSWORD
  if (!origin || !adminPassword || !/^https:\/\//.test(origin)) throw new Error('Production checkpoint requires HTTPS public origin and generated admin password')
  const messages = async (address: string) => {
    const response = await request.get(`http://127.0.0.1:8025/api/v1/search?query=${encodeURIComponent(`to:${address}`)}`)
    expect(response.ok()).toBe(true)
    return ((await response.json()).messages || []) as { ID: string }[]
  }
  const tokenFor = async (address: string) => {
    await expect.poll(async () => (await messages(address)).length).toBeGreaterThan(0)
    const [message] = await messages(address)
    const response = await request.get(`http://127.0.0.1:8025/api/v1/message/${message!.ID}`)
    expect(response.ok()).toBe(true)
    const messageBody = await response.json() as { Text?: string, HTML?: string }
    const token = `${messageBody.Text || ''} ${messageBody.HTML || ''}`.match(/invitacion\/([a-zA-Z0-9_-]{32,})/)?.[1]
    expect(token).toBeTruthy()
    return token!
  }
  const bookingCodeFor = async (address: string) => {
    await expect.poll(async () => (await messages(address)).length).toBeGreaterThan(0)
    const [message] = await messages(address)
    const response = await request.get(`http://127.0.0.1:8025/api/v1/message/${message!.ID}`)
    expect(response.ok()).toBe(true)
    const body = await response.json() as { Text?: string }
    const code = body.Text?.match(/\b\d{6}\b/)?.[0]
    expect(code).toBeTruthy()
    return code!
  }
  const context = await browser.newContext({ baseURL: origin, ignoreHTTPSErrors: true })
  let assistantContext: Awaited<ReturnType<typeof browser.newContext>> | undefined
  const page = await context.newPage()
  const workerErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error' && /service.worker|workbox|sw\.js/i.test(message.text())) workerErrors.push(message.text().slice(0, 250))
  })
  const signInCounts = new Map<string, number>()
  const signIn = async (username: string, secret: string) => {
    const next = (signInCounts.get(username) ?? 0) + 1
    expect(next, `Repeated sign-in for ${username} exceeds the production username limit`).toBeLessThanOrEqual(3)
    signInCounts.set(username, next)
    await page.goto('/acceso')
    await page.getByRole('textbox', { name: 'Usuario' }).fill(username)
    await page.getByLabel('Contraseña').fill(secret)
    await page.getByRole('button', { name: 'Ingresar' }).click()
    await expect(page).toHaveURL('/')
  }
  const setup = async (address: string, username: string, secret: string) => {
    const token = await tokenFor(address)
    await page.goto(`/invitacion/${token}`)
    await page.getByRole('textbox', { name: 'Usuario' }).fill(username)
    await page.getByLabel('Contraseña').fill(secret)
    await page.getByRole('button', { name: 'Guardar acceso' }).click()
    await expect(page).toHaveURL('/acceso')
  }
  try {
    const anonymousCatalog = await context.request.get('/api/admin/catalogos/MOTOR')
    expect(anonymousCatalog.status()).toBe(401)
    expect(anonymousCatalog.headers()['cache-control']).toContain('no-store')
    const anonymousCatalogPage = await context.request.get('/admin/catalogos')
    expect(anonymousCatalogPage.status()).toBe(401)
    expect(anonymousCatalogPage.headers()['cache-control']).toContain('no-store')
    expect(await anonymousCatalogPage.text()).not.toContain('Sin entradas verificadas para')
    await signIn('firstadmin', adminPassword)
    expect((await context.request.get('/api/clinical/access-check')).status()).toBe(403)
    expect((await context.request.get('/api/catalogos/VACCINE')).status()).toBe(403)
    expect((await context.request.post('/api/catalogos/hitos', { data: { label: 'No', domain: 'Motor', minAgeMonths: 1, maxAgeMonths: 2, source: 'No' } })).status()).toBe(403)
    await page.setViewportSize({ width: 375, height: 850 })
    const adminCatalogPage = await context.request.get('/admin/catalogos')
    expect(adminCatalogPage.status()).toBe(200)
    expect(adminCatalogPage.headers()['cache-control']).toContain('no-store')
    expect(await adminCatalogPage.text()).toContain('Catálogos preventivos')
    await page.goto('/admin/catalogos')
    await page.waitForLoadState('networkidle')
    await expect(page.getByRole('heading', { name: 'Catálogos preventivos' })).toBeVisible()
    const adminNavigation = await context.request.get('/api/auth/navigation')
    expect(adminNavigation.status()).toBe(200)
    expect(await adminNavigation.json()).toContainEqual(expect.objectContaining({ to: '/admin/catalogos' }))
    for (const [kind, label] of [['MOTOR', 'Hitos motores OMS'], ['MILESTONE', 'Hitos CDC'], ['SCREENING', 'Tamizajes'], ['CHECKUP', 'Controles AAP'], ['VACCINE', 'Vacunas MSP']] as const) {
      await page.getByRole('navigation', { name: 'Tipos de catálogo' }).getByRole('button', { name: label }).click()
      await expect(page.getByRole('button', { name: label })).toHaveAttribute('aria-pressed', 'true')
      const response = await context.request.get(`/api/admin/catalogos/${kind}`)
      expect(response.status(), kind).toBe(200)
      expect(response.headers()['cache-control']).toContain('no-store')
      const view = await response.json() as CatalogView
      expect(view.kind).toBe(kind)
      if (kind === 'VACCINE' || kind === 'CHECKUP') {
        expect(view.versions).toHaveLength(1)
        expect(view.versions[0]?.entries).toHaveLength(kind === 'VACCINE' ? 21 : 31)
        expect(view.versions[0]?.entries.every(row => row.badge === 'Borrador - pendiente de revisión')).toBe(true)
        expect(view.versions[0]?.entries.every(row => row.sourcePages?.length === (kind === 'VACCINE' ? 2 : 1))).toBe(true)
        if (kind === 'VACCINE') {
          expect(view.versions[0]?.entries.find(row => row.key === 'rotavirus-2')?.minimumInterval).toBe('1 mes')
          expect(view.versions[0]?.entries.find(row => row.key === 'pcv-2')?.minimumInterval).toBeNull()
          expect(view.versions[0]?.entries.find(row => row.key === 'bopv-2')?.doseLabel).toBe('bOPV oral: primer refuerzo')
        } else expect(view.versions[0]?.entries.find(row => row.key === 'day-3-5')).toMatchObject({ minAgeDays: 3, maxAgeDays: 5 })
        const seededSection = page.getByRole('region', { name: `${view.versions[0]!.title} · ${view.versions[0]!.version}` })
        await expect(seededSection.getByText('Borrador - pendiente de revisión')).toHaveCount(view.versions[0]!.entries.length)
      } else {
        expect(view.versions).toEqual([])
        await expect(page.getByText(`Sin entradas verificadas para ${label}`)).toBeVisible()
      }
      await expect(page.getByText(/Revisado ·|Aprobado ·|REVIEWED/)).toHaveCount(0)
      expect(await page.evaluate(() => document.documentElement.scrollWidth), kind).toBeLessThanOrEqual(376)
    }
    await page.setViewportSize({ width: 1440, height: 850 })
    await page.goto('/admin/catalogos')
    await page.waitForLoadState('networkidle')
    await page.getByRole('navigation', { name: 'Tipos de catálogo' }).getByRole('button', { name: 'Vacunas MSP' }).click()
    await expect(page.getByRole('region', { name: 'Esquema Nacional de Vacunación 2026 · 2026-07' }).getByText('Borrador - pendiente de revisión')).toHaveCount(21)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1441)
    for (const [address, role] of [[doctorEmail, 'DOCTOR'], [assistantEmail, 'ASSISTANT']] as const) {
      expect((await context.request.post('/api/auth/invite-staff', { data: { email: address, name: role, role } })).status()).toBe(200)
      await tokenFor(address)
    }
    await context.clearCookies()
    await setup(doctorEmail, 'journey-doctor', password)
    await setup(assistantEmail, 'journey-assistant', 'unique assistant setup phrase')
    await signIn('journey-assistant', 'unique assistant setup phrase')
    const assistantCatalog = await context.request.get('/api/admin/catalogos/MOTOR')
    expect(assistantCatalog.status()).toBe(403)
    expect(assistantCatalog.headers()['cache-control']).toContain('no-store')
    expect((await context.request.get('/api/catalogos/VACCINE')).status()).toBe(403)
    expect((await context.request.post('/api/catalogos/hitos', { data: { label: 'No', domain: 'Motor', minAgeMonths: 1, maxAgeMonths: 2, source: 'No' } })).status()).toBe(403)
    const assistantCatalogPage = await context.request.get('/admin/catalogos')
    expect(assistantCatalogPage.status()).toBe(403)
    expect(assistantCatalogPage.headers()['cache-control']).toContain('no-store')
    expect(await assistantCatalogPage.text()).not.toMatch(/Sin entradas verificadas para|Borrador - pendiente de revisión/)
    const assistantNavigation = await context.request.get('/api/auth/navigation')
    expect(assistantNavigation.status()).toBe(200)
    expect(await assistantNavigation.json()).not.toContainEqual(expect.objectContaining({ to: '/admin/catalogos' }))
    const bookingDate = new Date()
    bookingDate.setUTCDate(bookingDate.getUTCDate() + (8 - bookingDate.getUTCDay()) % 7 + 35)
    const bookingDay = bookingDate.toISOString().slice(0, 10)
    expect((await context.request.put('/api/agenda/horarios', { data: { days: [{ weekday: 1, open: '09:00', close: '11:00' }], durationMinutes: 30, blocked: [] } })).status()).toBe(200)
    assistantContext = await browser.newContext({ baseURL: origin, ignoreHTTPSErrors: true, storageState: await context.storageState() })
    await context.clearCookies()
    const bookingEmail = `booking-${randomUUID()}@example.test`
    const bookingPhone = '0991234567'
    await page.goto('/reservar')
    await page.waitForLoadState('networkidle')
    await page.getByLabel('Fecha', { exact: true }).fill(bookingDay)
    await expect(page.getByText('09:00', { exact: true })).toBeVisible()
    await page.getByText('09:00', { exact: true }).click()
    await page.getByRole('button', { name: 'Continuar' }).click()
    await page.getByRole('textbox', { name: 'Nombres y apellidos del niño/a' }).fill('Reserva Prueba')
    await page.getByLabel('Fecha de nacimiento').fill('2024-01-01')
    await page.getByLabel('Femenino').check()
    await page.getByRole('textbox', { name: 'Nombre del representante' }).fill('Familia Reserva')
    await page.getByRole('textbox', { name: 'Parentesco' }).fill('Madre')
    await page.getByRole('textbox', { name: 'Correo electrónico' }).fill(bookingEmail)
    await page.getByRole('textbox', { name: 'Teléfono / WhatsApp' }).fill(bookingPhone)
    await page.getByRole('button', { name: 'Continuar' }).click()
    await page.getByRole('checkbox').check()
    await page.getByRole('button', { name: 'Verificar correo' }).click()
    await expect(page.getByRole('heading', { name: 'Verificar correo' })).toBeVisible()
    const code = await bookingCodeFor(bookingEmail)
    await page.getByRole('textbox', { name: 'Código de 6 dígitos' }).fill(code)
    await page.getByRole('button', { name: 'Verificar', exact: true }).click()
    await page.getByRole('button', { name: 'Enviar solicitud' }).click()
    await expect(page.getByRole('heading', { name: 'Solicitud enviada' })).toBeVisible()
    expect((await context.request.get('/api/hijos')).status()).toBe(401)
    expect(assistantContext).toBeDefined()
    const pendingResponse = await assistantContext!.request.get('/api/agenda/solicitudes')
    expect(pendingResponse.status()).toBe(200)
    const pendingList = await pendingResponse.json() as { id: string, childName: string }[]
    const booking = pendingList.find(item => item.childName === 'Reserva Prueba')
    expect(booking).toBeTruthy()
    expect((await assistantContext!.request.post(`/api/agenda/solicitudes/${booking!.id}`, { data: { decision: 'APPROVE' } })).status()).toBe(200)
    const agendaEntry = await assistantContext!.request.get(`/api/agenda?from=${bookingDay}&to=${bookingDay}`)
    const bookingAppointments = await agendaEntry.json() as { name: string }[]
    expect(bookingAppointments.some(item => item.name === 'Reserva Prueba')).toBe(true)
    expect((await assistantContext!.request.get('/api/pacientes')).status()).toBe(403)
    await signIn('journey-doctor', password)
    expect((await context.request.get('/api/admin/catalogos/MOTOR')).status()).toBe(403)
    expect((await context.request.get('/admin/catalogos')).status()).toBe(403)
    await page.setViewportSize({ width: 375, height: 850 })
    await page.goto('/catalogos')
    await page.waitForLoadState('networkidle')
    const doctorVaccines = await context.request.get('/api/catalogos/VACCINE')
    expect(doctorVaccines.status()).toBe(200)
    expect((await doctorVaccines.json() as CatalogView).versions[0]?.entries).toHaveLength(21)
    await expect(page.getByText('Borrador - pendiente de revisión')).toHaveCount(21)
    await page.getByRole('button', { name: 'Hitos del desarrollo' }).click()
    await expect(page.getByText('Aún no hay hitos del desarrollo registrados')).toBeVisible()
    await page.getByRole('button', { name: 'Agregar hito' }).click()
    await page.getByRole('textbox', { name: 'Descripción' }).fill('Observación de la doctora')
    await page.getByRole('textbox', { name: 'Área' }).fill('Motor')
    await page.getByRole('spinbutton', { name: 'Edad mínima (meses)' }).fill('4')
    await page.getByRole('spinbutton', { name: 'Edad máxima (meses)' }).fill('6')
    await page.getByRole('textbox', { name: 'Fuente indicada por la doctora' }).fill('Registro de la doctora')
    await page.getByRole('button', { name: 'Guardar borrador' }).click()
    await expect(page.getByRole('heading', { name: 'Observación de la doctora' })).toBeVisible()
    await expect(page.getByText('Borrador - pendiente de revisión')).toHaveCount(1)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(376)
    const phone = `09${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`
    let guardianId: string | undefined
    const createChild = async (given: string, nationalId?: string) => {
      const result = await context.request.post('/api/pacientes/rapido', { data: { givenNames: given, surnames: 'Prueba', birthDate: '2024-01-01', sex: 'FEMALE', ...(nationalId ? { nationalId } : {}), contacts: [{ name: 'Familia de prueba', relationship: 'Madre', phone, email: '', proof: 'Identidad verificada presencialmente', invite: false, ...(given === 'Sol' ? { confirmedGuardianId: guardianId } : {}) }] } })
      expect(result.status(), await result.text()).toBe(200)
      const id = (await result.json()).patient.id as string
      const grant = await context.request.get(`/api/guardian-grants/${id}`)
      expect(grant.status()).toBe(200)
      expect((await grant.json()).guardians).toHaveLength(1)
      if (!guardianId) {
        const identity = await context.request.get(`/api/guardian-grants/identity?phone=${phone}`)
        expect(identity.status()).toBe(200)
        guardianId = (await identity.json()).id as string
      }
      return id
    }
    const first = await createChild('Luz')
    const second = await createChild('Sol', '1710034065')
    const preventive = await context.request.get(`/api/pacientes/${first}/preventivo/vacunas`)
    expect(preventive.status()).toBe(200)
    const preventiveRows = await preventive.json() as { pending: { key: string, badge: string, id: string }[] }
    expect(preventiveRows.pending.length).toBeGreaterThan(0)
    expect(preventiveRows.pending.every(row => row.badge === 'Borrador - pendiente de revisión')).toBe(true)
    const complementary = await context.request.post(`/api/pacientes/${first}/preventivo/complementarias`, { data: { label: 'Complementaria fixture del médico', doseLabel: 'Dosis individual', source: 'Criterio documentado de la doctora' } })
    expect(complementary.status(), await complementary.text()).toBe(200)
    const queue = await context.request.get('/api/clinical/vacunacion-por-revisar')
    expect(queue.status()).toBe(200)
    const rows = await queue.json() as { id: string, pending: { kind: string }[], contacts: { name: string, phone: string }[] }[]
    expect(rows.find(row => row.id === first)?.pending.some(item => item.kind === 'MSP')).toBe(true)
    expect(rows.find(row => row.id === first)?.pending.some(item => item.kind === 'COMPLEMENTARY')).toBe(true)
    expect(rows.find(row => row.id === first)?.contacts).toEqual([{ name: 'Familia de prueba', phone }])
    await page.goto('/pacientes/vacunacion-por-revisar')
    await expect(page.getByText('Complementaria fixture del médico')).toBeVisible()
    await expect(page.getByRole('link', { name: 'WhatsApp' }).first()).toHaveAttribute('href', `https://wa.me/593${phone.slice(1)}`)
    expect((await assistantContext!.request.get('/api/clinical/vacunacion-por-revisar')).status()).toBe(403)
    const firstDose = preventiveRows.pending[0]!
    const applied = await context.request.post(`/api/pacientes/${first}/preventivo/dosis`, { data: { releaseId: firstDose.id.split(':')[0], key: firstDose.key, appliedAt: '2025-01-02', lot: 'PRIVATE_PREVENTIVE_LOT', privateNote: 'PRIVATE_PREVENTIVE_NOTE', external: true } })
    expect(applied.status(), await applied.text()).toBe(200)
    const otherPhone = `09${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`
    const otherEmail = `other-${randomUUID()}@example.test`
    const otherChildResponse = await context.request.post('/api/pacientes/rapido', { data: { givenNames: 'Otra', surnames: 'Familia', birthDate: '2024-01-01', sex: 'FEMALE', contacts: [{ name: 'Otra madre', relationship: 'Madre', phone: otherPhone, email: otherEmail, proof: 'Identidad verificada presencialmente', invite: true }] } })
    expect(otherChildResponse.status(), await otherChildResponse.text()).toBe(200)
    const otherChild = (await otherChildResponse.json()).patient.id as string
    const otherGrant = await context.request.get(`/api/guardian-grants/${otherChild}`)
    expect((await otherGrant.json()).guardians[0].status).toBe('PENDING')
    const otherVisit = await context.request.post(`/api/pacientes/${otherChild}/visitas`, { data: { requestId: randomUUID(), measuredAt: '2025-01-01T12:00:00.000Z', weightKg: 9, lengthHeightCm: 75, position: 'RECUMBENT', headCircumferenceCm: 45, shareWithFamily: true, parentAdvice: 'ONLY_OTHER_FAMILY', privateNote: 'PRIVATE_OTHER_FAMILY' } })
    expect(otherVisit.status(), await otherVisit.text()).toBe(200)
    const otherPreview = await context.request.post(`/api/pacientes/${otherChild}/informes`)
    expect(otherPreview.status(), await otherPreview.text()).toBe(200)
    const otherReportId = (await otherPreview.json()).id as string
    expect((await context.request.post(`/api/pacientes/${otherChild}/informes/${otherReportId}/aprobar`)).status()).toBe(200)
    const secondRecord = await context.request.get(`/api/pacientes/${second}`)
    expect((await secondRecord.json()).patient.nationalId).toBe('1710034065')
    const firstRecord = await context.request.get(`/api/pacientes/${first}`)
    expect((await firstRecord.json()).patient.nationalId).toBeUndefined()
    const uninvited = await context.request.get(`/api/guardian-grants/${first}`)
    expect((await uninvited.json()).guardians[0].status).toBe('UNINVITED')
    const visit = await context.request.post(`/api/pacientes/${first}/visitas`, { data: { requestId: randomUUID(), measuredAt: '2025-01-01T12:00:00.000Z', weightKg: 9, lengthHeightCm: 75, position: 'RECUMBENT', headCircumferenceCm: 45, shareWithFamily: true, parentAdvice: 'Regresar en febrero', privateNote: 'PRIVATE_NEVER_SHOW' } })
    expect(visit.status(), await visit.text()).toBe(200)
    const visitId = (await visit.json()).id as string
    const privateVisit = await context.request.post(`/api/pacientes/${first}/visitas`, { data: { requestId: randomUUID(), measuredAt: '2025-02-01T12:00:00.000Z', weightKg: 10, lengthHeightCm: 78, position: 'RECUMBENT', headCircumferenceCm: 46, shareWithFamily: false, parentAdvice: 'HIDDEN_ADVICE' } })
    expect(privateVisit.status()).toBe(200)
    await page.setViewportSize({ width: 375, height: 850 })
    await page.goto(`/pacientes/${first}`)
    await expect(page.getByText(/Z [−+]?\d+,\d{2} · percentil/).first()).toBeVisible()
    const growth = await context.request.get(`/api/pacientes/${first}/crecimiento`)
    expect(growth.status()).toBe(200)
    expect((await growth.json()).charts.WEIGHT_FOR_AGE.curves).toHaveLength(7)
    await page.goto(`/pacientes/${first}/informe`)
    const doctorPdf = await context.request.get(`/api/pacientes/${first}/informes/medico?includePrivateNotes=true`)
    expect(doctorPdf.status()).toBe(200)
    expect(await pdfText(await doctorPdf.body())).toMatch(/PRIVATE_NEVER_SHOW/)
    const preview = await context.request.post(`/api/pacientes/${first}/informes`)
    expect(preview.status()).toBe(200)
    const reportId = (await preview.json()).id as string
    const draft = await context.request.get(`/api/pacientes/${first}/informes/${reportId}/vista-previa`)
    expect(draft.status()).toBe(200)
    const frozen = await draft.body()
    expect((await context.request.post(`/api/pacientes/${first}/informes/${reportId}/aprobar`)).status()).toBe(200)
    expect((await context.request.get(`/api/hijos/${first}/informes/${reportId}/pdf`)).status()).toBe(403)
    expect((await assistantContext!.request.get(`/api/pacientes/${first}/crecimiento`)).status()).toBe(403)
    expect(guardianId).toBeTruthy()
    const link = await assistantContext!.request.post('/api/guardian-grants', { data: { patientId: first, contact: { name: 'Familia de prueba', email, phone, relationship: 'Madre', proof: 'Identidad verificada presencialmente', confirmedGuardianId: guardianId } } })
    expect(link.status(), await link.text()).toBe(200)
    expect((await link.json()).status).toBe('PENDING')
    await context.clearCookies()
    await setup(email, 'journey-family', 'unique guardian setup phrase')
    expect((await assistantContext!.request.get('/api/agenda/solicitudes')).status()).toBe(200)
    const sibling = await assistantContext!.request.post('/api/guardian-grants', { data: { patientId: second, contact: { name: 'Familia de prueba', email, phone, relationship: 'Madre', proof: 'Identidad verificada presencialmente', confirmedGuardianId: guardianId } } })
    expect(sibling.status(), await sibling.text()).toBe(200)
    await context.clearCookies()
    await setup(otherEmail, 'journey-other-family', 'unique other guardian phrase')
    await signIn('journey-other-family', 'unique other guardian phrase')
    expect((await context.request.get(`/api/hijos/${otherChild}`)).status()).toBe(200)
    expect((await context.request.get(`/api/hijos/${first}`)).status()).toBe(404)
    await context.clearCookies()
    await signIn('journey-family', 'unique guardian setup phrase')
    expect((await context.request.get('/api/admin/catalogos/MOTOR')).status()).toBe(403)
    expect((await context.request.get('/api/catalogos/VACCINE')).status()).toBe(403)
    expect((await context.request.get('/api/clinical/vacunacion-por-revisar')).status()).toBe(403)
    expect((await context.request.get(`/api/pacientes/${first}/preventivo/vacunas`)).status()).toBe(403)
    const ownApplied = await context.request.get(`/api/hijos/${first}/vacunas`)
    expect(ownApplied.status()).toBe(200)
    expect(await ownApplied.text()).not.toMatch(/PRIVATE_PREVENTIVE_LOT|PRIVATE_PREVENTIVE_NOTE|Complementaria fixture del médico|phone/i)
    expect((await ownApplied.json() as { label: string }[])).toHaveLength(1)
    expect((await context.request.get(`/api/hijos/${otherChild}/vacunas`)).status()).toBe(404)
    expect((await context.request.get('/admin/catalogos')).status()).toBe(403)
    await expect(page.getByRole('heading', { name: 'Mis hijos' })).toBeVisible()
    const children = await context.request.get('/api/hijos')
    const visibleChildren = (await children.json()).map((item: { id: string }) => item.id)
    expect(visibleChildren).toEqual(expect.arrayContaining([first, second]))
    expect(visibleChildren).not.toContain(otherChild)
    for (const path of [`/api/hijos/${otherChild}`, `/api/hijos/${otherChild}/crecimiento`, `/api/hijos/${otherChild}/informes/${otherReportId}/pdf`, `/api/hijos/${otherChild}/informes/${otherReportId}`, `/hijos/${otherChild}`, `/hijos/${otherChild}/crecimiento`, `/hijos/${otherChild}/informe`]) {
      const denied = await context.request.get(path)
      expect(await denied.text(), path).not.toMatch(/ONLY_OTHER_FAMILY|PRIVATE_OTHER_FAMILY|Otra Familia|weightKg|percentile|"z"/i)
      expect(denied.status(), path).toBe(404)
      expect(denied.headers()['cache-control'], path).toContain('no-store')
    }
    await page.goto(`/hijos/${second}`)
    await expect(page.getByRole('heading', { name: 'Indicaciones de Sol Prueba' })).toBeVisible()
    await page.goto(`/hijos/${first}`)
    await expect(page.getByRole('heading', { name: 'Vacunas aplicadas' })).toBeVisible()
    expect(await page.locator('main').innerText()).not.toMatch(/PRIVATE_PREVENTIVE_LOT|PRIVATE_PREVENTIVE_NOTE|Complementaria fixture del médico/)
    const own = await context.request.get(`/api/hijos/${first}`)
    expect(own.headers()['cache-control']).toContain('no-store')
    expect(await own.text()).toContain('Regresar en febrero')
    expect(await own.text()).not.toMatch(/PRIVATE_NEVER_SHOW|HIDDEN_ADVICE|percentile|"z"|"bmi"|classification/i)
    const familyGrowth = await context.request.get(`/api/hijos/${first}/crecimiento`)
    expect(familyGrowth.status()).toBe(200)
    expect(await familyGrowth.text()).not.toMatch(/percentile|"z"|HIDDEN_ADVICE/)
    await page.goto(`/hijos/${first}/crecimiento`)
    await expect(page.locator('main canvas').first()).toBeVisible()
    const workerResponse = await context.request.get('/sw.js')
    expect(workerResponse.status()).toBe(200)
    expect(workerResponse.headers()['content-type']).toMatch(/javascript/)
    const registration = await page.evaluate(async () => {
      const snapshot = async () => ({ secure: isSecureContext, url: location.href, controller: navigator.serviceWorker?.controller?.scriptURL ?? null, registrations: 'serviceWorker' in navigator ? (await navigator.serviceWorker.getRegistrations()).map(item => ({ scope: item.scope, active: item.active?.state ?? null, scriptURL: item.active?.scriptURL ?? null })) : [] })
      if (!('serviceWorker' in navigator)) return { error: 'service worker unavailable', state: await snapshot() }
      return Promise.race([
        navigator.serviceWorker.ready.then(worker => ({ scope: worker.scope, scriptURL: worker.active?.scriptURL, state: worker.active?.state })),
        new Promise<{ error: string, state: Awaited<ReturnType<typeof snapshot>> }>(resolve => setTimeout(async () => resolve({ error: 'service worker registration not ready', state: await snapshot() }), 10000))
      ])
    })
    if ('error' in registration) throw new Error(JSON.stringify({ ...registration, workerErrors }))
    expect(registration.scope).toBe(`${origin}/`)
    expect(registration.scriptURL).toBe(`${origin}/sw.js`)
    expect(['activating', 'activated']).toContain(registration.state)
    await expect.poll(async () => page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.active?.state), { timeout: 30000 }).toBe('activated')
    await page.goto(`/hijos/${first}`)
    expect(await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL)).toBe(`${origin}/sw.js`)
    await expect(page.getByText('Regresar en febrero')).toBeVisible()
    const throughWorker = await page.evaluate(async (id) => {
      const response = await fetch(`/api/hijos/${id}`)
      return response.ok && (await response.text()).includes('Regresar en febrero')
    }, first)
    expect(throughWorker).toBe(true)
    const cacheKeys = await page.evaluate(async () => (await Promise.all((await caches.keys()).map(async name => (await caches.open(name)).keys()))).flat().map(request => request.url))
    expect(cacheKeys.filter(url => /\/(?:api|hijos|pacientes)\//.test(url) || /\/(?:hijos|pacientes)(?:$|\?)/.test(url))).toEqual([])
    await context.setOffline(true)
    expect(await page.evaluate(async id => fetch(`/api/hijos/${id}`).then(() => 'network', () => 'offline'), first)).toBe('offline')
    const offlineDocument = await context.newPage()
    try {
      await expect(offlineDocument.goto(`/hijos/${first}`, { waitUntil: 'domcontentloaded' })).rejects.toThrow()
      expect(await offlineDocument.locator('body').innerText().catch(() => '')).not.toMatch(/Regresar en febrero|PRIVATE_NEVER_SHOW/)
    } finally {
      await offlineDocument.close()
      await context.setOffline(false)
    }
    await page.goto(`/hijos/${first}/crecimiento`)
    await expect(page.locator('main canvas').first()).toBeVisible()
    const afterOffline = await page.evaluate(async () => (await Promise.all((await caches.keys()).map(async name => (await caches.open(name)).keys()))).flat().map(request => request.url))
    expect(afterOffline.filter(url => /\/(?:api|hijos|pacientes)\//.test(url) || /\/(?:hijos|pacientes)(?:$|\?)/.test(url))).toEqual([])
    const privateHtml = await context.request.get(`/hijos/${first}`)
    expect(privateHtml.headers()['cache-control']).toContain('no-store')
    expect(await privateHtml.text()).not.toMatch(/PRIVATE_NEVER_SHOW|HIDDEN_ADVICE/)
    const familyPdf = await context.request.get(`/api/hijos/${first}/informes/${reportId}/pdf`)
    expect(familyPdf.status()).toBe(200)
    expect(await familyPdf.body()).toEqual(frozen)
    expect(await pdfText(frozen)).toContain('Regresar en febrero')
    expect(await pdfText(frozen)).not.toMatch(/PRIVATE_NEVER_SHOW|HIDDEN_ADVICE|PRIVATE_PREVENTIVE_LOT|PRIVATE_PREVENTIVE_NOTE|percentil|puntuación Z/i)
    expect((await context.request.get(`/api/hijos/${randomUUID()}`)).status()).toBe(404)
    expect((await context.request.get(`/api/pacientes/${first}`)).status()).toBe(403)
    await context.clearCookies()
    await signIn('journey-doctor', password)
    expect((await context.request.patch(`/api/pacientes/${first}/visitas/${visitId}/compartir`, { data: { shared: false } })).status()).toBe(200)
    await context.clearCookies()
    await signIn('journey-family', 'unique guardian setup phrase')
    expect((await context.request.get(`/api/hijos/${first}/informes/${reportId}/pdf`)).status()).toBe(404)
    const revokedView = await context.request.get(`/api/hijos/${first}`)
    expect(await revokedView.text()).not.toContain('Regresar en febrero')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
  } finally {
    await assistantContext?.close()
    await context.close()
  }
})
