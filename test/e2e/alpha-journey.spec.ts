import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

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
  const page = await context.newPage()
  const workerErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error' && /service.worker|workbox|sw\.js/i.test(message.text())) workerErrors.push(message.text().slice(0, 250))
  })
  const signIn = async (username: string, secret: string) => {
    await page.goto('/acceso')
    await page.getByRole('textbox', { name: 'Usuario' }).fill(username)
    await page.getByLabel('Contraseña').fill(secret)
    let login: { status: number, code: string } | undefined
    const observeLogin = (result: import('@playwright/test').Response) => {
      if (result.request().method() !== 'POST' || !result.url().includes('/api/auth/sign-in/username')) return
      login = { status: result.status(), code: result.status() === 200 ? 'SUCCESS' : result.status() === 401 ? 'DENIED' : result.status() === 503 ? 'UNAVAILABLE' : 'OTHER' }
    }
    page.on('response', observeLogin)
    await page.getByRole('button', { name: 'Ingresar' }).click()
    try {
      await expect(page).toHaveURL('/')
    } catch (error) {
      const cookies = (await context.cookies(origin)).map(cookie => ({ secure: cookie.secure, httpOnly: cookie.httpOnly, sameSite: cookie.sameSite }))
      throw new Error(`checkpoint login diagnostic: status=${login?.status ?? 'NO_REQUEST'} class=${login?.code ?? 'NO_RESPONSE'} cookieFlags=${JSON.stringify(cookies)} uiError=${await page.getByRole('alert').isVisible().catch(() => false)}`, { cause: error })
    } finally {
      page.off('response', observeLogin)
    }
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
    await signIn('firstadmin', adminPassword)
    expect((await context.request.get('/api/clinical/access-check')).status()).toBe(403)
    for (const [address, role] of [[doctorEmail, 'DOCTOR'], [assistantEmail, 'ASSISTANT']] as const) {
      expect((await context.request.post('/api/auth/invite-staff', { data: { email: address, name: role, role } })).status()).toBe(200)
      await tokenFor(address)
    }
    await context.clearCookies()
    await setup(doctorEmail, 'journey-doctor', password)
    await setup(assistantEmail, 'journey-assistant', 'unique assistant setup phrase')
    await signIn('journey-assistant', 'unique assistant setup phrase')
    const bookingDate = new Date()
    bookingDate.setUTCDate(bookingDate.getUTCDate() + (8 - bookingDate.getUTCDay()) % 7 + 35)
    const bookingDay = bookingDate.toISOString().slice(0, 10)
    expect((await context.request.put('/api/agenda/horarios', { data: { days: [{ weekday: 1, open: '09:00', close: '11:00' }], durationMinutes: 30, blocked: [] } })).status()).toBe(200)
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
    await signIn('journey-assistant', 'unique assistant setup phrase')
    const pendingResponse = await context.request.get('/api/agenda/solicitudes')
    expect(pendingResponse.status()).toBe(200)
    const pendingList = await pendingResponse.json() as { id: string, childName: string }[]
    const booking = pendingList.find(item => item.childName === 'Reserva Prueba')
    expect(booking).toBeTruthy()
    expect((await context.request.post(`/api/agenda/solicitudes/${booking!.id}`, { data: { decision: 'APPROVE' } })).status()).toBe(200)
    const agendaEntry = await context.request.get(`/api/agenda?from=${bookingDay}&to=${bookingDay}`)
    const bookingAppointments = await agendaEntry.json() as { name: string }[]
    expect(bookingAppointments.some(item => item.name === 'Reserva Prueba')).toBe(true)
    expect((await context.request.get('/api/pacientes')).status()).toBe(403)
    await context.clearCookies()
    await signIn('journey-doctor', password)
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
    await context.clearCookies()
    await signIn('journey-assistant', 'unique assistant setup phrase')
    expect((await context.request.get(`/api/pacientes/${first}/crecimiento`)).status()).toBe(403)
    expect(guardianId).toBeTruthy()
    const link = await context.request.post('/api/guardian-grants', { data: { patientId: first, contact: { name: 'Familia de prueba', email, phone, relationship: 'Madre', proof: 'Identidad verificada presencialmente', confirmedGuardianId: guardianId } } })
    expect(link.status(), await link.text()).toBe(200)
    expect((await link.json()).status).toBe('PENDING')
    await context.clearCookies()
    await setup(email, 'journey-family', 'unique guardian setup phrase')
    await signIn('journey-assistant', 'unique assistant setup phrase')
    const sibling = await context.request.post('/api/guardian-grants', { data: { patientId: second, contact: { name: 'Familia de prueba', email, phone, relationship: 'Madre', proof: 'Identidad verificada presencialmente', confirmedGuardianId: guardianId } } })
    expect(sibling.status(), await sibling.text()).toBe(200)
    await context.clearCookies()
    await setup(otherEmail, 'journey-other-family', 'unique other guardian phrase')
    await signIn('journey-other-family', 'unique other guardian phrase')
    expect((await context.request.get(`/api/hijos/${otherChild}`)).status()).toBe(200)
    expect((await context.request.get(`/api/hijos/${first}`)).status()).toBe(404)
    await context.clearCookies()
    await signIn('journey-family', 'unique guardian setup phrase')
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
    expect(await pdfText(frozen)).not.toMatch(/PRIVATE_NEVER_SHOW|HIDDEN_ADVICE|percentil|puntuación Z/i)
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
    await context.close()
  }
})
