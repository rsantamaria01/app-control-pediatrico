import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Pool } from 'pg'
import { eq } from 'drizzle-orm'
import { readFile, mkdtemp, rm, cp, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'
import manifest from '../../scripts/who-2006-manifest.json'
import { WhoIndicator } from '../../shared/utils/enums'
import type { Gender } from '../../shared/utils/enums'
import { importWhoRelease, parseWhoWorkbook } from '../../server/services/who-import'
import type { VerifiedSource } from '../../shared/types/who'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { vaccineDose, familyReport, guardianGrant, patient, user, visit, visitSharing, visitText } from '../../server/db/schema'
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
const legacyId = randomUUID()
let legacyVisitId = ''
let legacyBefore: Record<string, unknown>
let legacyApprovedAt: Date
let created = false

beforeAll(async () => {
  await adminPool.query(`CREATE DATABASE "${name}"`)
  created = true
  process.env.DATABASE_URL = target.href
  const migrations = resolve('server/db/migrations')
  const directory = await mkdtemp(join(tmpdir(), 'pediatrico-report-upgrade-'))
  try {
    await cp(migrations, directory, { recursive: true })
    const journal = JSON.parse(await readFile(join(directory, 'meta/_journal.json'), 'utf8')) as { entries: { tag: string }[] }
    journal.entries = journal.entries.filter(entry => Number(entry.tag.slice(0, 4)) < 28)
    await writeFile(join(directory, 'meta/_journal.json'), JSON.stringify(journal))
    await migrate(db, { migrationsFolder: directory })
    await db.insert(patient).values({ id: childId, name: 'Niña del informe', birthDate: '2024-01-01', sex: 'FEMALE', createdBy: doctor.id })
    legacyVisitId = randomUUID()
    await db.insert(visit).values({ id: legacyVisitId, patientId: childId, requestId: randomUUID(), requestDigest: 'fixture', measuredAt: new Date('2025-01-01T12:00:00Z'), weightKg: '9', lengthHeightCm: '75', position: 'RECUMBENT', headCircumferenceCm: '45', bmi: '16', birthDateAtVisit: '2024-01-01', sexAtVisit: 'FEMALE', correctionUntilMonths: 24, authorId: doctor.id })
    await db.insert(visitText).values({ visitId: legacyVisitId, privateNote: 'PRIVATE_ARCHIVE', parentAdvice: 'Texto histórico sin resultados' })
    legacyApprovedAt = new Date('2026-11-15T03:00:00Z')
    const content = { name: 'Niña histórica', birthDate: '2024-01-01', visits: [{ id: legacyVisitId, measuredAt: '2025-01-01T12:00:00.000Z', weightKg: 9, lengthHeightCm: 75, position: 'RECUMBENT', headCircumferenceCm: 45, nextControlAt: null, parentAdvice: 'Texto histórico sin resultados' }], charts: {}, sources: [] }
    await pool.query('INSERT INTO family_report (id, patient_id, content, version, created_by, created_at, approved_by, approved_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [legacyId, childId, JSON.stringify(content), 1, doctor.id, new Date('2026-11-15T01:00:00Z'), doctor.id, legacyApprovedAt])
    legacyBefore = (await pool.query('SELECT * FROM family_report WHERE id = $1', [legacyId])).rows[0]
    await migrate(db, { migrationsFolder: migrations })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
  await db.insert(patient).values([
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

async function importRelease() {
  const entries = await Promise.all(manifest.files.map(async (file) => {
    const bytes = await readFile(resolve('/tmp/opencode/who-2006', `${file.name}-expanded.xlsx`))
    const indicator = file.indicator as WhoIndicator
    const isLength = indicator === WhoIndicator.WEIGHT_FOR_LENGTH
    const isHeight = indicator === WhoIndicator.WEIGHT_FOR_HEIGHT
    const source: VerifiedSource = {
      publisher: 'WHO', standard: 'WHO_2006', version: manifest.version,
      publicationDate: file.publicationDate, retrievedAt: manifest.retrievedAt,
      url: file.url, sha256: file.sha256, bytes, indicator, sex: file.sex as Gender,
      position: isLength ? 'RECUMBENT' : isHeight ? 'STANDING' : null,
      xUnit: isLength || isHeight ? 'CM' : 'DAY', minX: isLength ? 45 : isHeight ? 65 : 0,
      maxX: isLength ? 110 : isHeight ? 120 : 1856, step: isLength || isHeight ? 0.1 : 1
    }
    return { source, rows: await parseWhoWorkbook(source, bytes) }
  }))
  await importWhoRelease(entries)
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
    expect(draft.content.visits.map(item => item.id)).toEqual(expect.arrayContaining([legacyVisitId, sharedId]))
    expect(draft.content.visits).toHaveLength(2)
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
    await db.insert(vaccineDose).values({ id: randomUUID(), patientId: childId, key: 'report-fixture', label: 'Vacuna posterior', catalogVersion: 'Registro médico', sourcePage: 'Consulta', sourceStatus: 'DRAFT_PENDING_PEDIATRICIAN_REVIEW', appliedAt: '2025-01-01', external: false, lot: 'PRIVATE_LOT', privateNote: 'PRIVATE_VACCINE', authorId: doctor.id })
    const retrieved = await getApprovedReport(guardian, childId, approved.id)
    expect(retrieved.content.visits[0]?.parentAdvice).toBe('Indicaciones compartidas')
    expect(JSON.stringify(retrieved)).not.toMatch(/PRIVATE|Cambio posterior|Vacuna posterior|\bz\b|percentile|classification|status|bmi/i)
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

  it('upgrades a populated 0027 approved row without advertising an unavailable PDF and requires explicit doctor reissue', async () => {
    const { listFamilyReports, renderFamilyReport, getApprovedReport, listLegacyReports, previewFamilyReport, approveFamilyReport } = await import('../../server/services/reports')
    await db.update(guardianGrant).set({ status: 'ACTIVE' }).where(eq(guardianGrant.patientId, childId))
    expect((await listFamilyReports(guardian, childId)).map(report => report.id)).not.toContain(legacyId)
    await expect(renderFamilyReport(guardian, childId, legacyId)).rejects.toMatchObject({ statusCode: 404 })
    await expect(getApprovedReport(stranger, childId, legacyId)).rejects.toMatchObject({ statusCode: 404 })
    expect(await listLegacyReports(doctor, childId)).toEqual([{ id: legacyId, approvedAt: legacyApprovedAt.toISOString() }])
    await expect(listLegacyReports(assistant, childId)).rejects.toMatchObject({ statusCode: 403 })
    const newDraft = await previewFamilyReport(doctor, childId)
    expect(newDraft.id).not.toBe(legacyId)
    await expect(renderFamilyReport(guardian, childId, newDraft.id)).rejects.toMatchObject({ statusCode: 404 })
    const reissued = await approveFamilyReport(doctor, newDraft.id)
    expect((await listFamilyReports(guardian, childId)).map(report => report.id)).toContain(reissued.id)
    expect((await listFamilyReports(guardian, childId)).map(report => report.id)).not.toContain(legacyId)
    expect((await renderFamilyReport(guardian, childId, reissued.id)).subarray(0, 4).toString()).toBe('%PDF')
    const after = await pool.query('SELECT * FROM family_report WHERE id = $1', [legacyId])
    expect(after.rows[0]).toEqual({ ...legacyBefore, pdf_base64: null })
    await db.insert(visitSharing).values({ visitId: legacyVisitId, shared: false, changedBy: doctor.id })
    await expect(renderFamilyReport(guardian, childId, reissued.id)).rejects.toMatchObject({ statusCode: 404 })
    expect(await listFamilyReports(guardian, childId)).toEqual([])
    await db.update(guardianGrant).set({ status: 'REVOKED' }).where(eq(guardianGrant.patientId, childId))
    await expect(renderFamilyReport(guardian, childId, reissued.id)).rejects.toMatchObject({ statusCode: 404 })
  }, 120000)

  it('doctor previews identical frozen PDF bytes before approval, despite later branding changes', async () => {
    const { previewFamilyReport, approveFamilyReport, getDoctorPreviewPdf, renderFamilyReport } = await import('../../server/services/reports')
    await db.update(guardianGrant).set({ status: 'ACTIVE' }).where(eq(guardianGrant.patientId, childId))
    await seedVisit(true, 'PRIVATE_PREVIEW', 'Recomendación visible antes de aprobar')
    const draft = await previewFamilyReport(doctor, childId)
    const before = await getDoctorPreviewPdf(doctor, childId, draft.id)
    expect(before.subarray(0, 4).toString()).toBe('%PDF')
    expect((await pdfText(before)).join(' ')).toContain('Recomendación visible antes de aprobar')
    expect((await pdfText(before)).join(' ')).toContain('Nacimiento: 1 ene 2024')
    expect((await pdfText(before)).join(' ')).not.toContain('PRIVATE_PREVIEW')
    await expect(db.update(familyReport).set({ pdfBase64: 'ALTERED' }).where(eq(familyReport.id, draft.id))).rejects.toBeDefined()
    await expect(renderFamilyReport(guardian, childId, draft.id)).rejects.toMatchObject({ statusCode: 404 })
    const priorBrand = process.env.NUXT_PUBLIC_CLINIC_PRIMARY
    try {
      process.env.NUXT_PUBLIC_CLINIC_PRIMARY = 'violet'
      const approved = await approveFamilyReport(doctor, draft.id)
      process.env.NUXT_PUBLIC_CLINIC_PRIMARY = 'rose'
      expect(await renderFamilyReport(guardian, childId, approved.id)).toEqual(before)
      expect(await getDoctorPreviewPdf(doctor, childId, draft.id)).toEqual(before)
      const laterVisit = await seedVisit(true, 'PRIVATE_AFTER', 'Otra indicación posterior')
      expect(await renderFamilyReport(guardian, childId, approved.id)).toEqual(before)
      await db.insert(visitSharing).values({ visitId: laterVisit, shared: false, changedBy: doctor.id })
      expect(await renderFamilyReport(guardian, childId, approved.id)).toEqual(before)
      await expect(db.update(familyReport).set({ pdfBase64: 'ALTERED' }).where(eq(familyReport.id, draft.id))).rejects.toBeDefined()
    } finally {
      if (priorBrand === undefined) delete process.env.NUXT_PUBLIC_CLINIC_PRIMARY
      else process.env.NUXT_PUBLIC_CLINIC_PRIMARY = priorBrand
    }
  })

  it('uses immutable visit age and position provenance for every shared point after patient background changes', async () => {
    const { previewFamilyReport } = await import('../../server/services/reports')
    await importRelease()
    const historicalId = randomUUID()
    const birthday = '2024-01-01'
    await db.insert(patient).values({ id: historicalId, name: 'Niña prematura', birthDate: birthday, sex: 'FEMALE', gestationDays: 252, correctionUntilMonths: 24, createdBy: doctor.id })
    const early = randomUUID()
    const later = randomUUID()
    await db.insert(visit).values([
      { id: early, patientId: historicalId, requestId: randomUUID(), requestDigest: 'fixture', measuredAt: new Date('2025-01-01T12:00:00Z'), weightKg: '9', lengthHeightCm: '75', position: 'RECUMBENT', headCircumferenceCm: '45', bmi: '16', gestationDaysAtBirth: 252, birthDateAtVisit: birthday, sexAtVisit: 'FEMALE', correctionUntilMonths: 24, authorId: doctor.id },
      { id: later, patientId: historicalId, requestId: randomUUID(), requestDigest: 'fixture', measuredAt: new Date('2026-01-02T12:00:00Z'), weightKg: '12', lengthHeightCm: '88', position: 'STANDING', headCircumferenceCm: '48', bmi: '15', gestationDaysAtBirth: 252, birthDateAtVisit: birthday, sexAtVisit: 'FEMALE', correctionUntilMonths: 24, authorId: doctor.id }
    ])
    await db.update(patient).set({ gestationDays: 280, birthDate: '2024-02-01' }).where(eq(patient.id, historicalId))
    const sameTime = randomUUID()
    await db.insert(visit).values({ id: sameTime, patientId: historicalId, requestId: randomUUID(), requestDigest: 'fixture', measuredAt: new Date('2026-01-02T12:00:00Z'), weightKg: '12.5', lengthHeightCm: '89', position: 'RECUMBENT', headCircumferenceCm: '48', bmi: '15', gestationDaysAtBirth: 252, birthDateAtVisit: birthday, sexAtVisit: 'FEMALE', correctionUntilMonths: 24, authorId: doctor.id })
    const report = await previewFamilyReport(doctor, historicalId)
    const lengthPanels = report.content.charts.HEIGHT_FOR_AGE
    expect(lengthPanels).toHaveLength(2)
    expect(lengthPanels?.flatMap(panel => panel.points.map(point => point.x))).toContain(338)
    expect(lengthPanels?.flatMap(panel => panel.points.map(point => point.x))).toContain(732)
    expect(lengthPanels?.flatMap(panel => panel.points.map(point => point.y))).toContain(75)
    expect(lengthPanels?.flatMap(panel => panel.points.map(point => point.y))).toContain(88)
    const pages = await pdfText(await (await import('../../server/services/reports')).getDoctorPreviewPdf(doctor, historicalId, report.id))
    expect(pages.join(' ')).toContain('Longitud acostada')
    expect(pages.join(' ')).toContain('Talla de pie')
    expect(pages.join(' ')).toMatch(/Edad de referencia|edad de referencia/)
    expect(pages.join(' ')).not.toMatch(/−3|\+3|Puntuación Z|percentil/i)
  }, 120000)

  it('doctor curves identify all seven reference lines while family curves expose only neutral scaled axes', async () => {
    const { renderDoctorReport, previewFamilyReport, getDoctorPreviewPdf } = await import('../../server/services/reports')
    await importRelease()
    const clinicalPatient = randomUUID()
    await db.insert(patient).values({ id: clinicalPatient, name: 'Niña de curvas', birthDate: '2024-01-01', sex: 'FEMALE', createdBy: doctor.id })
    const { createVisit } = await import('../../server/services/visits')
    await createVisit(doctor, clinicalPatient, { requestId: randomUUID(), measuredAt: '2025-01-01T12:00:00Z', weightKg: 9, lengthHeightCm: 75, position: 'RECUMBENT', headCircumferenceCm: 45 })
    const clinical = await pdfText(await renderDoctorReport(doctor, clinicalPatient, false))
    const draft = await previewFamilyReport(doctor, clinicalPatient)
    expect(draft.content.charts.HEIGHT_FOR_AGE).toHaveLength(1)
    const family = await pdfText(await getDoctorPreviewPdf(doctor, clinicalPatient, draft.id))
    expect(clinical.join(' ')).toMatch(/−3.*−2.*−1.*0.*\+1.*\+2.*\+3/s)
    expect(family.join(' ')).toMatch(/Edad de referencia.*días/s)
    expect(family.join(' ')).not.toMatch(/−3|\+3|percentil|Puntuación Z/i)
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
