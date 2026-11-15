import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Pool } from 'pg'
import { eq } from 'drizzle-orm'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { familyReport, guardianGrant, patient, user, visit, visitSharing, visitText } from '../../server/db/schema'
import type { Actor } from '../../shared/types/access'

const configured = process.env.TEST_DATABASE_URL
if (!configured || new URL(configured).pathname !== '/pediatrico_auth_slice2_test' || configured === process.env.DATABASE_URL) throw new Error('Dedicated auth test database required')
const name = `pediatrico_reports_${randomUUID().replace(/-/g, '')}`
const target = new URL(configured)
target.pathname = `/${name}`
const admin = new URL(configured)
admin.pathname = '/postgres'
const adminPool = new Pool({ connectionString: admin.href })
const pool = new Pool({ connectionString: target.href })
const db = drizzle(pool)
const previous = process.env.DATABASE_URL
const doctor: Actor = { id: randomUUID(), roles: ['DOCTOR'] }
const guardian: Actor = { id: randomUUID(), roles: ['PATIENT'] }
const stranger: Actor = { id: randomUUID(), roles: ['PATIENT'] }
const assistant: Actor = { id: randomUUID(), roles: ['ASSISTANT'] }
const childId = randomUUID()
const otherChildId = randomUUID()
let created = false

beforeAll(async () => {
  await adminPool.query(`CREATE DATABASE "${name}"`)
  created = true
  process.env.DATABASE_URL = target.href
  await migrate(db, { migrationsFolder: './server/db/migrations' })
  await db.insert(patient).values([
    { id: childId, name: 'Niña del informe', birthDate: '2024-01-01', sex: 'FEMALE', createdBy: doctor.id },
    { id: otherChildId, name: 'Otra niña', birthDate: '2024-01-01', sex: 'FEMALE', createdBy: doctor.id }
  ])
  await db.insert(user).values({ id: guardian.id, name: 'Familia', email: 'guardian@example.test' })
  await db.insert(guardianGrant).values({ patientId: childId, guardianId: guardian.id, contactEmail: 'guardian@example.test', proof: 'Identidad verificada', verifiedBy: doctor.id, status: 'ACTIVE' })
}, 120000)

afterAll(async () => {
  process.env.DATABASE_URL = previous
  await pool.end()
  const { useDb } = await import('../../server/utils/db')
  await useDb().$client.end()
  try {
    if (created) await adminPool.query(`DROP DATABASE "${name}"`)
  } finally {
    await adminPool.end()
  }
})

async function seedVisit(shared: boolean, note: string, advice: string) {
  const id = randomUUID()
  await db.insert(visit).values({ id, patientId: childId, requestId: randomUUID(), requestDigest: 'fixture', measuredAt: new Date('2025-01-01T12:00:00Z'), weightKg: '9', lengthHeightCm: '75', position: 'RECUMBENT', headCircumferenceCm: '45', bmi: '16', birthDateAtVisit: '2024-01-01', sexAtVisit: 'FEMALE', correctionUntilMonths: 24, authorId: doctor.id, shareWithFamily: shared })
  await db.insert(visitText).values({ visitId: id, privateNote: note, parentAdvice: advice, clinicianTrend: 'PRIVATE_TREND' })
  return id
}

async function pdfText(bytes: Buffer) {
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true })
  const pdf = await task.promise
  const pages: string[] = []
  for (let index = 1; index <= pdf.numPages; index++) {
    const page = await pdf.getPage(index)
    const text = await page.getTextContent()
    pages.push(text.items.map(item => 'str' in item ? item.str : '').join(' '))
  }
  await task.destroy()
  return pages
}

describe('approved report boundary', () => {
  it('requires explicit approval, excludes unshared visits and private fields, and freezes the approved allowlist', async () => {
    const { previewFamilyReport, approveFamilyReport, getApprovedReport } = await import('../../server/services/reports')
    const sharedId = await seedVisit(true, 'PRIVATE_SECRET', 'Indicaciones compartidas')
    await seedVisit(false, 'PRIVATE_HIDDEN', 'Oculto')
    const draft = await previewFamilyReport(doctor, childId)
    expect(draft.content.visits).toHaveLength(1)
    expect(JSON.stringify(draft)).not.toMatch(/PRIVATE|Oculto|\bz\b|percentile|classification|status|bmi|normal|abnormal/i)
    await expect(getApprovedReport(guardian, childId, draft.id)).rejects.toMatchObject({ statusCode: 404 })
    await expect(approveFamilyReport(assistant, draft.id)).rejects.toMatchObject({ statusCode: 403 })
    const approved = await approveFamilyReport(doctor, draft.id)
    expect(approved.approvedBy).toBe(doctor.id)
    expect(approved.approvedAt).toBeTruthy()
    await expect(db.update(familyReport).set({ content: { name: 'Cambio posterior' } }).where(eq(familyReport.id, approved.id))).rejects.toBeDefined()
    await expect(db.delete(familyReport).where(eq(familyReport.id, approved.id))).rejects.toBeDefined()
    await expect(db.update(visitText).set({ parentAdvice: 'Cambio posterior', privateNote: 'PRIVATE_NEW' }).where(eq(visitText.visitId, sharedId))).rejects.toMatchObject({ cause: { message: 'Clinical snapshots are immutable' } })
    const laterId = await seedVisit(true, 'PRIVATE_NEW', 'Cambio posterior')
    const retrieved = await getApprovedReport(guardian, childId, approved.id)
    expect(retrieved.content.visits[0]?.parentAdvice).toBe('Indicaciones compartidas')
    expect(JSON.stringify(retrieved)).not.toMatch(/PRIVATE|Cambio posterior|\bz\b|percentile|classification|status|bmi/i)
    await expect(getApprovedReport(stranger, childId, approved.id)).rejects.toMatchObject({ statusCode: 404 })
    await expect(getApprovedReport({ id: guardian.id, roles: ['PATIENT', 'DOCTOR'] }, childId, approved.id)).rejects.toMatchObject({ statusCode: 404 })
    await expect(getApprovedReport(guardian, otherChildId, approved.id)).rejects.toMatchObject({ statusCode: 404 })
    await db.insert(visitSharing).values({ visitId: sharedId, shared: false, changedBy: doctor.id })
    await db.insert(visitSharing).values({ visitId: laterId, shared: false, changedBy: doctor.id })
    await expect(getApprovedReport(guardian, childId, approved.id)).rejects.toMatchObject({ statusCode: 404 })
    await db.update(visitSharing).set({ shared: true }).where(eq(visitSharing.visitId, sharedId))
    await db.update(guardianGrant).set({ status: 'REVOKED' }).where(eq(guardianGrant.patientId, childId))
    await expect(getApprovedReport(guardian, childId, approved.id)).rejects.toMatchObject({ statusCode: 404 })
  })

  it('paginates long shared advice without dropping its end or adding private data', async () => {
    const { previewFamilyReport, approveFamilyReport, renderFamilyReport } = await import('../../server/services/reports')
    const advice = `${'Controlar alimentación y descanso. '.repeat(500)} FIN_DEL_TEXTO`
    await db.update(guardianGrant).set({ status: 'ACTIVE' }).where(eq(guardianGrant.patientId, childId))
    await seedVisit(true, 'PRIVATE_LONG', advice)
    const preview = await previewFamilyReport(doctor, childId)
    const approved = await approveFamilyReport(doctor, preview.id)
    const pages = await pdfText(await renderFamilyReport(guardian, childId, approved.id))
    expect(pages.length).toBeGreaterThan(3)
    expect(pages.join(' ')).toContain('FIN_DEL_TEXTO')
    expect(pages.join(' ')).not.toContain('PRIVATE_LONG')
    expect(pages.every((page, index) => page.includes(`Página ${index + 1} de ${pages.length}`))).toBe(true)
  })

  it('doctor PDF includes private notes only with explicit option and family PDF never includes them', async () => {
    const { renderDoctorReport, renderFamilyReport, previewFamilyReport, approveFamilyReport } = await import('../../server/services/reports')
    await db.update(guardianGrant).set({ status: 'ACTIVE' }).where(eq(guardianGrant.patientId, childId))
    const pdf = await renderDoctorReport(doctor, childId, false)
    const privatePdf = await renderDoctorReport(doctor, childId, true)
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF')
    expect((await pdfText(pdf)).join(' ')).not.toContain('PRIVATE_SECRET')
    expect((await pdfText(privatePdf)).join(' ')).toContain('PRIVATE_SECRET')
    const draft = await previewFamilyReport(doctor, childId)
    const approved = await approveFamilyReport(doctor, draft.id)
    const familyPdf = await renderFamilyReport(guardian, childId, approved.id)
    expect(familyPdf.subarray(0, 4).toString()).toBe('%PDF')
    const pages = await pdfText(familyPdf)
    expect(pages.join(' ')).toContain('Indicaciones compartidas')
    expect(pages.join(' ')).not.toMatch(/PRIVATE|Puntuación Z|percentil|clasificación|normal|anormal/i)
    expect(pages.join(' ')).toContain('Curvas de crecimiento OMS')
    expect(pages.join(' ')).toContain('Indicaciones y próximos controles')
    expect(pages.length).toBeGreaterThanOrEqual(3)
    expect(pages.every((page, index) => page.includes(`Página ${index + 1} de ${pages.length}`)), JSON.stringify(pages.map(page => page.slice(-140)))).toBe(true)
  })
})
