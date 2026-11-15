import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'
import { notoSansRegular, notoSansBold } from './report-fonts'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { createError } from 'nuxt/server'
import PDFDocument from 'pdfkit'
import type { Actor } from '../../shared/types/access'
import type { DatasetId } from '../../shared/types/who'
import type { FamilyChartView, FamilyPoint } from '../../shared/utils/chart-data'
import { buildFamilyChartData } from '../../shared/utils/chart-data'
import { Gender, INDICATOR_LABEL, WhoIndicator } from '../../shared/utils/enums'
import { formatGrowthValues } from '../../shared/utils/growth-result'
import { familyReport, guardianGrant, patient, user, visit, visitSharing, visitText, whoDataset } from '../db/schema'
import { useDb } from '../utils/db'
import { recordAudit } from './audit'
import { authorizeClinical, getPatient } from './patients'
import { getVisits } from './visits'
import { selectReference } from './reference-selection'
import { getWhoRows } from './who-import'
import { clinicBrand } from '../../app/utils/clinic-brand'

export type FamilyReportVisit = { id: string, measuredAt: string, weightKg: number, lengthHeightCm: number, position: 'RECUMBENT' | 'STANDING', headCircumferenceCm: number, nextControlAt: string | null, parentAdvice: string | null }
export type ReportContent = { name: string, birthDate: string, visits: FamilyReportVisit[], charts: Partial<Record<WhoIndicator, FamilyChartView[]>>, sources: { version: string, sourceUrl: string }[] }
export type ReportDraft = { id: string, patientId: string, content: ReportContent, version: number, createdAt: string }
export type ApprovedReport = ReportDraft & { approvedBy: string, approvedAt: string }

const indicators = [WhoIndicator.WEIGHT_FOR_AGE, WhoIndicator.HEIGHT_FOR_AGE, WhoIndicator.HEAD_CIRCUMFERENCE_FOR_AGE]
const dateFormat = new Intl.DateTimeFormat('es-EC', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'America/Guayaquil' })
const dateTimeFormat = new Intl.DateTimeFormat('es-EC', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'America/Guayaquil' })
const numberFormat = (digits: number) => new Intl.NumberFormat('es-EC', { minimumFractionDigits: digits, maximumFractionDigits: digits })

function draft(row: typeof familyReport.$inferSelect): ReportDraft {
  return { id: row.id, patientId: row.patientId, content: row.content as ReportContent, version: row.version, createdAt: row.createdAt.toISOString() }
}

function approved(row: typeof familyReport.$inferSelect): ApprovedReport {
  return { ...draft(row), approvedBy: row.approvedBy!, approvedAt: row.approvedAt!.toISOString() }
}

async function familyCharts(history: { item: FamilyReportVisit, birthDate: string | null, gestationDays: number | null, correctionUntilMonths: number, sex: string | null }[]): Promise<{ charts: ReportContent['charts'], sources: ReportContent['sources'] }> {
  const charts: ReportContent['charts'] = {}
  const sources: ReportContent['sources'] = []
  for (const indicator of indicators) {
    const selected: { datasetId: DatasetId, position: 'RECUMBENT' | 'STANDING' | null, sex: Gender, point: FamilyPoint }[] = []
    for (const { item, birthDate, gestationDays, correctionUntilMonths, sex } of history) {
      if (!birthDate || !Object.values(Gender).includes(sex as Gender)) continue
      const ref = await selectReference({ birthDate: new Date(`${birthDate}T00:00:00Z`), measuredAt: new Date(item.measuredAt), gestationDays: gestationDays ?? undefined,
        correctionUntilMonths: correctionUntilMonths as 24 | 36, measuredLengthHeightCm: item.lengthHeightCm, position: item.position, sex: sex as Gender, indicator })
      if ('unavailableReason' in ref) continue
      selected.push({ datasetId: ref.datasetId, position: ref.referencePosition, sex: sex as Gender, point: {
        measuredAt: item.measuredAt, x: ref.x, y: indicator === WhoIndicator.WEIGHT_FOR_AGE ? item.weightKg : indicator === WhoIndicator.HEIGHT_FOR_AGE ? item.lengthHeightCm + ref.adjustmentCm : item.headCircumferenceCm,
        ageBasis: ref.ageBasis, chronologicalAgeDays: ref.chronologicalAgeDays
      } })
    }
    const panels: FamilyChartView[] = []
    const represented = new Set<number>()
    for (const [index, selectedGroup] of selected.entries()) {
      if (represented.has(index)) continue
      try {
        const rows = await getWhoRows(selectedGroup.datasetId, indicator, selectedGroup.sex, selectedGroup.position)
        const chart = buildFamilyChartData(rows, selected.filter(item => item.datasetId === selectedGroup.datasetId && item.position === selectedGroup.position && item.sex === selectedGroup.sex).map(item => item.point))
        if (!chart) continue
        const [source] = await useDb().select({ version: whoDataset.version, sourceUrl: whoDataset.sourceUrl }).from(whoDataset).where(and(eq(whoDataset.id, selectedGroup.datasetId), eq(whoDataset.sealed, true)))
        if (!source) continue
        panels.push(chart)
        for (const [otherIndex, item] of selected.entries()) {
          if (item.datasetId === selectedGroup.datasetId && item.position === selectedGroup.position && item.sex === selectedGroup.sex) represented.add(otherIndex)
        }
        if (!sources.some(item => item.version === source.version && item.sourceUrl === source.sourceUrl)) sources.push({ version: source.version, sourceUrl: source.sourceUrl })
      } catch {
        continue
      }
    }
    if (panels.length) charts[indicator] = panels
  }
  return { charts, sources }
}

export async function previewFamilyReport(actor: Actor, patientId: string): Promise<ReportDraft> {
  await authorizeClinical(actor, 'CLINICAL_WRITE', patientId)
  const db = useDb()
  const [person] = await db.select().from(patient).where(eq(patient.id, patientId))
  if (!person) throw createError({ statusCode: 404, statusMessage: 'Not found' })
  const rows = await db.select({ id: visit.id, measuredAt: visit.measuredAt, weightKg: visit.weightKg, lengthHeightCm: visit.lengthHeightCm, position: visit.position, headCircumferenceCm: visit.headCircumferenceCm, nextControlAt: visit.nextControlAt, parentAdvice: visitText.parentAdvice,
    birthDate: visit.birthDateAtVisit, gestationDays: visit.gestationDaysAtBirth, correctionUntilMonths: visit.correctionUntilMonths, sex: visit.sexAtVisit })
    .from(visit).leftJoin(visitText, eq(visitText.visitId, visit.id)).leftJoin(visitSharing, eq(visitSharing.visitId, visit.id))
    .where(and(eq(visit.patientId, patientId), sql`coalesce(${visitSharing.shared}, ${visit.shareWithFamily}) = true`)).orderBy(desc(visit.measuredAt), desc(visit.createdAt))
  if (!rows.length) throw createError({ statusCode: 409, statusMessage: 'No hay controles compartidos' })
  const visits: FamilyReportVisit[] = rows.map(row => ({ id: row.id, measuredAt: row.measuredAt.toISOString(), weightKg: Number(row.weightKg), lengthHeightCm: Number(row.lengthHeightCm), position: row.position as FamilyReportVisit['position'], headCircumferenceCm: Number(row.headCircumferenceCm), nextControlAt: row.nextControlAt?.toISOString() ?? null, parentAdvice: row.parentAdvice }))
  const { charts, sources } = await familyCharts(rows.map((row, index) => ({ item: visits[index]!, birthDate: row.birthDate, gestationDays: row.gestationDays, correctionUntilMonths: row.correctionUntilMonths, sex: row.sex })))
  const content: ReportContent = { name: person.name, birthDate: person.birthDate, visits, charts, sources }
  const createdAt = new Date()
  const brand = await branding()
  const pdfBase64 = (await makeFamilyPdf(content, createdAt.toISOString(), brand)).toString('base64')
  const [row] = await db.insert(familyReport).values({ id: randomUUID(), patientId, content, pdfBase64, version: 1, createdBy: actor.id, createdAt }).returning()
  return draft(row!)
}

export async function approveFamilyReport(actor: Actor, draftId: string): Promise<ApprovedReport> {
  await authorizeClinical(actor, 'CLINICAL_WRITE')
  const db = useDb()
  const result = await db.transaction(async (tx) => {
    const [row] = await tx.select().from(familyReport).where(eq(familyReport.id, draftId)).for('update')
    if (!row || row.approvedAt) throw createError({ statusCode: 404, statusMessage: 'Draft not found' })
    const content = row.content as ReportContent
    const ids = content.visits.map(item => item.id)
    if (!ids.length) throw createError({ statusCode: 409, statusMessage: 'No shared visits' })
    const shared = await tx.select({ id: visit.id }).from(visit).leftJoin(visitSharing, eq(visitSharing.visitId, visit.id)).where(and(eq(visit.patientId, row.patientId), inArray(visit.id, ids), sql`coalesce(${visitSharing.shared}, ${visit.shareWithFamily}) = true`))
    if (shared.length !== ids.length) throw createError({ statusCode: 409, statusMessage: 'Sharing changed; create a new preview' })
    if (!row.pdfBase64) throw createError({ statusCode: 409, statusMessage: 'PDF unavailable; create a new preview' })
    const [saved] = await tx.update(familyReport).set({ approvedBy: actor.id, approvedAt: new Date() }).where(and(eq(familyReport.id, draftId), sql`${familyReport.approvedAt} IS NULL`)).returning()
    return approved(saved!)
  })
  await recordAudit('REPORT_APPROVE', 'ALLOWED', actor.id, result.patientId)
  return result
}

export async function getDoctorDraft(actor: Actor, patientId: string, draftId: string): Promise<ReportDraft> {
  await authorizeClinical(actor, 'CLINICAL_READ', patientId)
  const [row] = await useDb().select().from(familyReport).where(and(eq(familyReport.patientId, patientId), eq(familyReport.id, draftId)))
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Not found' })
  return row.approvedAt ? approved(row) : draft(row)
}

export async function listLegacyReports(actor: Actor, patientId: string): Promise<{ id: string, approvedAt: string }[]> {
  await authorizeClinical(actor, 'CLINICAL_READ', patientId)
  const [exists] = await useDb().select({ id: patient.id }).from(patient).where(eq(patient.id, patientId))
  if (!exists) throw createError({ statusCode: 404, statusMessage: 'Patient not found' })
  const rows = await useDb().select({ id: familyReport.id, approvedAt: familyReport.approvedAt }).from(familyReport).where(and(eq(familyReport.patientId, patientId), sql`${familyReport.approvedAt} IS NOT NULL`, sql`${familyReport.pdfBase64} IS NULL`)).orderBy(desc(familyReport.approvedAt))
  return rows.map(row => ({ id: row.id, approvedAt: row.approvedAt!.toISOString() }))
}

export async function listFamilyReports(actor: Actor, patientId: string): Promise<{ id: string, approvedAt: string }[]> {
  const db = useDb()
  const [grant] = actor.roles.length === 1 && actor.roles[0] === 'PATIENT' ? await db.select({ patientId: guardianGrant.patientId }).from(guardianGrant).where(and(eq(guardianGrant.patientId, patientId), eq(guardianGrant.guardianId, actor.id), eq(guardianGrant.status, 'ACTIVE'))) : []
  if (!grant) throw createError({ statusCode: 404, statusMessage: 'Not found' })
  const rows = await db.select().from(familyReport).where(and(eq(familyReport.patientId, patientId), sql`${familyReport.approvedAt} IS NOT NULL`, sql`${familyReport.pdfBase64} IS NOT NULL`)).orderBy(desc(familyReport.approvedAt))
  const accessible: { id: string, approvedAt: string }[] = []
  for (const row of rows) {
    try {
      await getApprovedReport(actor, patientId, row.id)
      accessible.push({ id: row.id, approvedAt: row.approvedAt!.toISOString() })
    } catch {
      continue
    }
  }
  return accessible
}

export async function getApprovedReport(guardian: Actor, patientId: string, reportId: string): Promise<ApprovedReport> {
  const db = useDb()
  if (guardian.roles.length !== 1 || guardian.roles[0] !== 'PATIENT') throw createError({ statusCode: 404, statusMessage: 'Not found' })
  const [match] = await db.select().from(familyReport).innerJoin(guardianGrant, and(eq(guardianGrant.patientId, familyReport.patientId), eq(guardianGrant.guardianId, guardian.id), eq(guardianGrant.status, 'ACTIVE')))
    .where(and(eq(familyReport.id, reportId), eq(familyReport.patientId, patientId), sql`${familyReport.approvedAt} IS NOT NULL`, sql`${familyReport.pdfBase64} IS NOT NULL`))
  const row = match?.family_report
  if (!row) {
    await recordAudit('REPORT_READ', 'DENIED', guardian.id, patientId)
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  }
  const content = row.content as ReportContent
  const ids = content.visits.map(item => item.id)
  if (!ids.length) throw createError({ statusCode: 404, statusMessage: 'Not found' })
  const shared = await db.select({ id: visit.id }).from(visit).leftJoin(visitSharing, eq(visitSharing.visitId, visit.id)).where(and(eq(visit.patientId, patientId), inArray(visit.id, ids), sql`coalesce(${visitSharing.shared}, ${visit.shareWithFamily}) = true`))
  if (shared.length !== ids.length) {
    await recordAudit('REPORT_READ', 'DENIED', guardian.id, patientId)
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  }
  await recordAudit('REPORT_READ', 'ALLOWED', guardian.id, patientId)
  return approved(row)
}

function date(value: string) {
  const input = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00Z` : value
  return dateFormat.format(new Date(input))
}
function decimal(value: number, digits: number) {
  return numberFormat(digits).format(value)
}

async function pdfDocument(build: (doc: PDFKit.PDFDocument) => Promise<void> | void): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 48, autoFirstPage: false, bufferPages: true, info: { Title: 'Informe de crecimiento', Author: 'Control Pediátrico' } })
  const chunks: Buffer[] = []
  doc.on('data', chunk => chunks.push(chunk as Buffer))
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
  })
  doc.registerFont('regular', Buffer.from(notoSansRegular))
  doc.registerFont('bold', Buffer.from(notoSansBold))
  await build(doc)
  const count = doc.bufferedPageRange().count
  for (let i = 0; i < count; i++) {
    doc.switchToPage(i)
    doc.font('regular').fontSize(8).fillColor('#64748b').text(`Página ${i + 1} de ${count}`, 450, 760, { width: 95, align: 'right', lineBreak: false })
  }
  doc.end()
  return done
}

function section(doc: PDFKit.PDFDocument, title: string, primary: string) {
  if (doc.y > 735) doc.addPage()
  doc.moveDown(0.5).font('bold').fontSize(14).fillColor(primary).text(title)
  doc.moveDown(0.4).font('regular').fontSize(10).fillColor('#0f172a')
}

function paragraph(doc: PDFKit.PDFDocument, text: string) {
  if (doc.y > 750) doc.addPage()
  doc.font('regular').fontSize(10).fillColor('#0f172a').text(text, { width: 495 })
  doc.moveDown(0.45)
}

function start(doc: PDFKit.PDFDocument, title: string, name: string, primary: string, logo?: Buffer, issuedAt = new Date().toISOString()) {
  doc.addPage()
  if (logo) doc.image(logo, 48, 44, { fit: [38, 38] })
  doc.font('bold').fontSize(18).fillColor(primary).text(title, logo ? 96 : 48, 50, { width: logo ? 449 : 497 })
  doc.font('regular').fontSize(10).fillColor('#64748b').text(name, 48, 87)
  doc.text(`Emitido el ${date(issuedAt)}`, 48, 105)
  doc.moveTo(48, 128).lineTo(547, 128).strokeColor(primary).lineWidth(2).stroke()
  doc.y = 142
}

async function branding(): Promise<{ primary: string, logo?: Buffer }> {
  const brand = clinicBrand(process.env.NUXT_PUBLIC_CLINIC_PRIMARY ?? 'brand', process.env.NUXT_PUBLIC_CLINIC_LOGO ?? '')
  const colors: Record<string, string> = { brand: '#0f766e', teal: '#0d9488', indigo: '#4338ca', violet: '#6d28d9', rose: '#be123c', emerald: '#047857' }
  let logo: Buffer | undefined
  try {
    const raw = await readFile(join(process.env.NODE_ENV === 'production' ? '.output/public' : 'public', brand.logo))
    if (raw.length <= 1_000_000) logo = await sharp(raw, { limitInputPixels: 2_000_000 }).resize(96, 96, { fit: 'inside' }).png().toBuffer()
  } catch {
    logo = undefined
  }
  return { primary: colors[brand.primary]!, logo }
}

function chart(doc: PDFKit.PDFDocument, view: FamilyChartView, title: string, primary: string, doctor = false) {
  if (doc.y > 510) doc.addPage()
  section(doc, title, primary)
  const top = doc.y + 8
  const width = 485
  const height = 210
  const curves = view.curves.flatMap(item => item.data)
  const values = [...curves, ...view.points.map(item => [item.x, item.y] as [number, number])]
  if (!values.length || view.curves.length !== 7) return
  const xs = values.map(item => item[0])
  const ys = values.map(item => item[1])
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  if (minX === maxX || minY === maxY) return
  const x = (n: number) => 55 + (n - minX) / (maxX - minX) * width
  const y = (n: number) => top + height - (n - minY) / (maxY - minY) * height
  doc.rect(55, top, width, height).lineWidth(0.5).strokeColor('#94a3b8').stroke()
  doc.font('regular').fontSize(8).fillColor('#475569')
  for (const step of [0, 0.5, 1]) {
    const xValue = minX + (maxX - minX) * step
    const yValue = minY + (maxY - minY) * step
    doc.text(decimal(xValue, view.xUnit === 'DAY' ? 0 : 1), x(xValue) - 16, top + height + 2, { width: 32, align: 'center', lineBreak: false })
    doc.text(decimal(yValue, 1), 15, y(yValue) - 5, { width: 38, align: 'right', lineBreak: false })
  }
  for (const [index, curve] of view.curves.entries()) {
    if (!curve.data.length) continue
    doc.moveTo(x(curve.data[0]![0]), y(curve.data[0]![1]))
    for (const point of curve.data.slice(1)) doc.lineTo(x(point[0]), y(point[1]))
    doc.strokeColor('#94a3b8').lineWidth(0.7).stroke()
    if (doctor) doc.font('bold').fontSize(8).fillColor('#334155').text(['−3', '−2', '−1', '0', '+1', '+2', '+3'][index]!, 542, y(curve.data.at(-1)![1]) - 5, { width: 22, lineBreak: false })
  }
  for (const point of view.points) doc.circle(x(point.x), y(point.y), 3).fill('#1d4ed8')
  doc.y = top + height + 18
  paragraph(doc, `Eje horizontal: ${view.xUnit === 'DAY' ? 'Edad de referencia (días; corregida cuando corresponda)' : 'Longitud o talla (cm)'}. Eje vertical: ${view.indicator === WhoIndicator.HEIGHT_FOR_AGE || view.indicator === WhoIndicator.HEAD_CIRCUMFERENCE_FOR_AGE ? 'centímetros (cm)' : view.indicator === WhoIndicator.BMI_FOR_AGE ? 'IMC (kg/m²)' : 'peso (kg)'}. Curvas OMS 2006 y mediciones del niño en azul.`)
}

async function makeFamilyPdf(content: ReportContent, issuedAt: string, brand: { primary: string, logo?: Buffer }): Promise<Buffer> {
  const { primary, logo } = brand
  return pdfDocument((doc) => {
    start(doc, 'Informe de crecimiento', content.name, primary, logo, issuedAt)
    section(doc, 'Paciente y controles compartidos', primary)
    paragraph(doc, `Nacimiento: ${date(content.birthDate)}.`)
    for (const item of content.visits) paragraph(doc, `${date(item.measuredAt)} · Peso ${decimal(item.weightKg, 2)} kg · ${item.position === 'RECUMBENT' ? 'Longitud acostada' : 'Talla de pie'} ${decimal(item.lengthHeightCm, 1)} cm · Perímetro cefálico ${decimal(item.headCircumferenceCm, 1)} cm`)
    doc.addPage()
    section(doc, 'Curvas de crecimiento OMS', primary)
    for (const indicator of indicators) {
      const panels = content.charts[indicator]
      if (panels?.length) {
        for (const panel of panels) chart(doc, panel, `${INDICATOR_LABEL[indicator]} · ${indicator === WhoIndicator.HEIGHT_FOR_AGE ? panel.points[0]!.x <= 730 ? 'Longitud acostada' : 'Talla de pie' : 'Mediciones'}`, primary)
      } else paragraph(doc, `${INDICATOR_LABEL[indicator]}: referencia OMS no disponible.`)
    }
    doc.addPage()
    section(doc, 'Indicaciones y próximos controles', primary)
    for (const item of content.visits) {
      paragraph(doc, `Control del ${date(item.measuredAt)}`)
      if (item.parentAdvice) paragraph(doc, item.parentAdvice)
      if (item.nextControlAt) paragraph(doc, `Próximo control: ${dateTimeFormat.format(new Date(item.nextControlAt))}`)
    }
    paragraph(doc, content.sources.length ? `Fuente: Patrones de Crecimiento Infantil OMS 2006 · ${content.sources.map(item => item.version).join(', ')}.` : 'Patrones de Crecimiento Infantil OMS 2006: referencia no disponible para este informe.')
    for (const source of content.sources) paragraph(doc, `Fuente oficial: ${source.sourceUrl}`)
  })
}

export async function getDoctorPreviewPdf(actor: Actor, patientId: string, reportId: string): Promise<Buffer> {
  await authorizeClinical(actor, 'CLINICAL_READ', patientId)
  const [row] = await useDb().select({ pdfBase64: familyReport.pdfBase64 }).from(familyReport).where(and(eq(familyReport.patientId, patientId), eq(familyReport.id, reportId)))
  if (!row?.pdfBase64) throw createError({ statusCode: 404, statusMessage: 'Not found' })
  return Buffer.from(row.pdfBase64, 'base64')
}

export async function renderFamilyReport(actor: Actor, patientId: string, reportId: string): Promise<Buffer> {
  await getApprovedReport(actor, patientId, reportId)
  const [row] = await useDb().select({ pdfBase64: familyReport.pdfBase64 }).from(familyReport).where(and(eq(familyReport.patientId, patientId), eq(familyReport.id, reportId)))
  if (!row?.pdfBase64) throw createError({ statusCode: 404, statusMessage: 'Not found' })
  return Buffer.from(row.pdfBase64, 'base64')
}

export async function renderDoctorReport(actor: Actor, patientId: string, includePrivateNotes: boolean): Promise<Buffer> {
  const person = await getPatient(actor, patientId)
  const visits = await getVisits(actor, patientId)
  const doctor = await useDb().select({ name: user.name }).from(user).where(eq(user.id, actor.id)).limit(1)
  const { getDoctorGrowth } = await import('./growth-charts')
  const growth = await getDoctorGrowth(actor, patientId)
  const { primary, logo } = await branding()
  return pdfDocument((doc) => {
    start(doc, 'Informe clínico de crecimiento', person.name, primary, logo)
    section(doc, 'Paciente y resultados', primary)
    paragraph(doc, `Nacimiento: ${date(person.birthDate)} · ${person.sex === 'FEMALE' ? 'Femenino' : 'Masculino'}. Profesional: ${doctor[0]?.name ?? actor.id}.`)
    for (const item of visits) {
      paragraph(doc, `${date(item.measuredAt)} · Peso ${decimal(item.weightKg, 2)} kg · ${item.position === 'RECUMBENT' ? 'Longitud acostada' : 'Talla de pie'} ${decimal(item.lengthHeightCm, 1)} cm · Perímetro cefálico ${decimal(item.headCircumferenceCm, 1)} cm · IMC ${decimal(item.bmi, 2)}`)
      for (const result of item.results) {
        if (result.status === 'available') paragraph(doc, `${result.recalculationId ? 'Revisión médica · ' : ''}${INDICATOR_LABEL[result.indicator as WhoIndicator]} · ${formatGrowthValues(result.z, result.percentile)} · ${result.classification.name ?? 'Sin nombre OMS'} · ${result.reference.ageBasis === 'CORRECTED' ? 'Edad corregida' : 'Edad cronológica'} ${result.reference.referenceAgeDays} días · OMS ${result.reference.version} · ${result.reference.sourceUrl}`)
        else paragraph(doc, `${INDICATOR_LABEL[result.indicator as WhoIndicator]} · No disponible`)
      }
    }
    doc.addPage()
    section(doc, 'Curvas de crecimiento OMS', primary)
    for (const indicator of [WhoIndicator.WEIGHT_FOR_AGE, WhoIndicator.HEIGHT_FOR_AGE, WhoIndicator.HEAD_CIRCUMFERENCE_FOR_AGE, WhoIndicator.BMI_FOR_AGE, WhoIndicator.WEIGHT_FOR_LENGTH, WhoIndicator.WEIGHT_FOR_HEIGHT]) {
      const view = growth.charts[indicator]
      if (view) chart(doc, { ...view, curves: view.curves.map(curve => ({ data: curve.data })), points: view.points.map(point => ({ ...point, chronologicalAgeDays: point.x })) }, INDICATOR_LABEL[indicator], primary, true)
      else paragraph(doc, `${INDICATOR_LABEL[indicator]}: referencia OMS no disponible.`)
    }
    doc.addPage()
    section(doc, 'Indicaciones y próximos controles', primary)
    for (const item of visits) {
      paragraph(doc, `Control del ${date(item.measuredAt)}`)
      if (item.parentAdvice) paragraph(doc, `Indicaciones: ${item.parentAdvice}`)
      if (item.nextControlAt) paragraph(doc, `Próximo control: ${dateTimeFormat.format(new Date(item.nextControlAt))}`)
      if (includePrivateNotes && item.privateNote) paragraph(doc, `Nota clínica privada: ${item.privateNote}`)
      if (includePrivateNotes && item.clinicianTrend) paragraph(doc, `Tendencia clínica: ${item.clinicianTrend}`)
    }
    paragraph(doc, 'Fuente: Patrones de Crecimiento Infantil OMS 2006. Solo se muestran curvas con referencias oficiales selladas.')
  })
}
