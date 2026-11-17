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
import { getClinicReportBrand } from './clinic-settings'

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

async function pdfDocument(build: (doc: PDFKit.PDFDocument) => Promise<void> | void, privateNotes = false): Promise<Buffer> {
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
    doc.moveTo(48, 760).lineTo(547, 760).strokeColor('#e2e8f0').lineWidth(0.7).stroke()
    if (!privateNotes) doc.font('regular').fontSize(8).fillColor('#64748b').text('No incluye notas clínicas privadas', 48, 771, { width: 300, lineBreak: false })
    doc.text(`Página ${i + 1} de ${count}`, 440, 771, { width: 107, align: 'right', lineBreak: false })
  }
  doc.end()
  return done
}

function page(doc: PDFKit.PDFDocument, title: string, name: string, primary: string, logo?: Buffer, issuedAt = new Date().toISOString()) {
  doc.addPage()
  if (logo) doc.image(logo, 48, 42, { fit: [34, 34] })
  doc.font('bold').fontSize(12).fillColor('#0f172a').text('Control Pediátrico', logo ? 92 : 48, 48, { width: 190, lineBreak: false })
  doc.font('bold').fontSize(14).fillColor(primary).text(title, 313, 45, { width: 234, align: 'right', lineBreak: false })
  doc.font('regular').fontSize(8).fillColor('#64748b').text(`${name} · Emitido el ${date(issuedAt)}`, 290, 68, { width: 257, align: 'right', lineBreak: false })
  doc.moveTo(48, 94).lineTo(547, 94).strokeColor(primary).lineWidth(1.5).stroke()
  doc.y = 110
}

function heading(doc: PDFKit.PDFDocument, title: string, y: number, primary = '#0f172a') {
  doc.font('bold').fontSize(11).fillColor(primary).text(title, 48, y, { width: 499 })
}

function textBlock(doc: PDFKit.PDFDocument, text: string, y: number, options: { fill?: string, width?: number, size?: number } = {}): number {
  doc.font('regular').fontSize(options.size ?? 9).fillColor(options.fill ?? '#0f172a')
  const width = options.width ?? 499
  const height = doc.heightOfString(text, { width })
  doc.text(text, 48, y, { width })
  return y + height
}

function flowBlock(doc: PDFKit.PDFDocument, title: string, text: string, primary: string, nextPage: () => void, tint = false) {
  doc.font('regular').fontSize(9)
  const height = doc.heightOfString(text, { width: 471 }) + 40
  if (height > 630) {
    if (doc.y > 115) nextPage()
    let remaining = text
    let continuation = false
    while (remaining) {
      const top = doc.y
      doc.font('bold').fontSize(10).fillColor(primary).text(continuation ? `${title} (continuación)` : title, 48, top, { width: 499 })
      doc.font('regular').fontSize(9).fillColor('#0f172a')
      const available = 745 - (top + 18)
      let end = remaining.length
      if (doc.heightOfString(remaining, { width: 499 }) > available) {
        let low = 1
        let high = remaining.length
        while (low < high) {
          const middle = Math.ceil((low + high) / 2)
          if (doc.heightOfString(remaining.slice(0, middle), { width: 499 }) <= available) low = middle
          else high = middle - 1
        }
        end = low
        const boundary = Math.max(remaining.lastIndexOf(' ', end - 1), remaining.lastIndexOf('\n', end - 1))
        if (boundary > 0) end = boundary + 1
      }
      const part = remaining.slice(0, end)
      const partHeight = doc.heightOfString(part, { width: 499 })
      doc.text(part, 48, top + 18, { width: 499 })
      remaining = remaining.slice(end)
      doc.y = top + 18 + partHeight + 12
      if (remaining) {
        nextPage()
        continuation = true
      }
    }
    return
  }
  if (doc.y + height > 745) nextPage()
  const top = doc.y
  doc.roundedRect(48, top, 499, height, 6).fillAndStroke(tint ? '#f0fdfa' : '#ffffff', tint ? '#f0fdfa' : '#e2e8f0')
  doc.font('bold').fontSize(10).fillColor(tint ? primary : '#0f172a').text(title, 60, top + 10, { width: 475 })
  doc.font('regular').fontSize(9).fillColor('#0f172a').text(text, 60, top + 27, { width: 471 })
  doc.y = top + height + 12
}

async function branding(): Promise<{ primary: string, logo?: Buffer }> {
  const persisted = await getClinicReportBrand()
  const brand = clinicBrand(persisted.primary, persisted.logo)
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

function chart(doc: PDFKit.PDFDocument, view: FamilyChartView, title: string, yTop: number, height = 255, doctor = false): number {
  const width = 499
  doc.roundedRect(48, yTop, width, height, 6).strokeColor('#e2e8f0').lineWidth(0.8).stroke()
  doc.font('bold').fontSize(10).fillColor('#0f172a').text(title, 60, yTop + 12, { width: 450, lineBreak: false })
  const curves = view.curves
  const values = [...curves.flatMap(curve => curve.data), ...view.points.map(point => [point.x, point.y] as [number, number])]
  if (curves.length !== 7 || curves.some(curve => curve.data.length < 2) || !values.length) {
    doc.font('regular').fontSize(9).fillColor('#64748b').text('Referencia OMS no disponible.', 60, yTop + 45)
    doc.y = yTop + height
    return doc.y
  }
  const xs = values.map(point => point[0])
  const ys = values.map(point => point[1])
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  if (minX === maxX || minY === maxY) {
    doc.font('regular').fontSize(9).fillColor('#64748b').text('Referencia OMS no disponible.', 60, yTop + 45)
    doc.y = yTop + height
    return doc.y
  }
  const left = 91
  const top = yTop + 39
  const plotWidth = 415
  const plotHeight = height - 76
  const x = (n: number) => left + (n - minX) / (maxX - minX) * plotWidth
  const y = (n: number) => top + plotHeight - (n - minY) / (maxY - minY) * plotHeight
  for (let step = 0; step <= 4; step++) {
    const xValue = minX + (maxX - minX) * step / 4
    const yValue = minY + (maxY - minY) * step / 4
    doc.moveTo(x(xValue), top).lineTo(x(xValue), top + plotHeight).strokeColor('#f1f5f9').lineWidth(0.5).stroke()
    doc.moveTo(left, y(yValue)).lineTo(left + plotWidth, y(yValue)).stroke()
    doc.font('regular').fontSize(7).fillColor('#64748b').text(decimal(view.xUnit === 'DAY' && doctor ? xValue / 30.4375 : xValue, view.xUnit === 'DAY' ? 0 : 1), x(xValue) - 16, top + plotHeight + 3, { width: 32, align: 'center', lineBreak: false })
    doc.text(decimal(yValue, 1), 53, y(yValue) - 5, { width: 32, align: 'right', lineBreak: false })
  }
  doc.moveTo(left, top).lineTo(left, top + plotHeight).lineTo(left + plotWidth, top + plotHeight).strokeColor('#cbd5e1').lineWidth(0.8).stroke()
  doc.save()
  doc.rect(left, top, plotWidth, plotHeight).clip()
  if (doctor) {
    const lower = curves[1]!.data
    const upper = curves[5]!.data
    doc.moveTo(x(lower[0]![0]), y(lower[0]![1]))
    for (const point of lower.slice(1)) doc.lineTo(x(point[0]), y(point[1]))
    for (const point of [...upper].reverse()) doc.lineTo(x(point[0]), y(point[1]))
    doc.closePath().fill('#f0fdfa')
  }
  const colors = doctor ? ['#dc2626', '#ea580c', '#ca8a04', '#334155', '#ca8a04', '#ea580c', '#dc2626'] : Array(7).fill('#94a3b8') as string[]
  for (const [index, curve] of curves.entries()) {
    doc.moveTo(x(curve.data[0]![0]), y(curve.data[0]![1]))
    for (const point of curve.data.slice(1)) doc.lineTo(x(point[0]), y(point[1]))
    doc.strokeColor(colors[index]!).lineWidth(doctor && index === 3 ? 1.4 : 0.9).stroke()
  }
  const points = [...view.points].sort((a, b) => a.x - b.x)
  if (points.length) {
    doc.moveTo(x(points[0]!.x), y(points[0]!.y))
    for (const point of points.slice(1)) doc.lineTo(x(point.x), y(point.y))
    doc.strokeColor('#1d4ed8').lineWidth(1.8).stroke()
    for (const point of points) doc.circle(x(point.x), y(point.y), 2.8).fillAndStroke('#ffffff', '#1d4ed8')
  }
  doc.restore()
  if (doctor) {
    for (const [index, curve] of curves.entries()) {
      const last = curve.data.at(-1)!
      doc.font('bold').fontSize(7).fillColor(colors[index]!).text(['−3', '−2', '−1', '0', '+1', '+2', '+3'][index]!, 511, y(last[1]) - 4, { width: 24, lineBreak: false })
    }
  }
  doc.font('regular').fontSize(8).fillColor('#64748b').text(view.xUnit === 'DAY' ? doctor ? 'Edad de referencia (meses)' : 'Edad de referencia (días)' : 'Longitud o talla (cm)', 155, yTop + height - 18, { width: 290, align: 'center', lineBreak: false })
  doc.y = yTop + height
  return doc.y
}

async function makeFamilyPdf(content: ReportContent, issuedAt: string, brand: { primary: string, logo?: Buffer }): Promise<Buffer> {
  const { primary, logo } = brand
  return pdfDocument((doc) => {
    const newPage = () => page(doc, 'Informe de crecimiento', content.name, primary, logo, issuedAt)
    newPage()
    doc.roundedRect(48, 112, 499, 85, 6).fill('#f8fafc')
    summaryCell(doc, 'Paciente', content.name, 60, 122, 250)
    summaryCell(doc, 'Nacimiento', date(content.birthDate), 322, 122, 210)
    summaryCell(doc, 'Última medición', date(content.visits[0]!.measuredAt), 60, 159, 250)
    summaryCell(doc, 'Referencia', content.sources.length ? 'OMS 2006 · curvas verificadas' : 'No disponible', 322, 159, 210)
    heading(doc, 'Últimos valores compartidos', 215)
    const latest = content.visits[0]!
    table(doc, 238, ['Medición', 'Valor'], [
      ['Peso', `${decimal(latest.weightKg, 2)} kg`],
      [latest.position === 'RECUMBENT' ? 'Longitud acostada' : 'Talla de pie', `${decimal(latest.lengthHeightCm, 1)} cm`],
      ['Perímetro cefálico', `${decimal(latest.headCircumferenceCm, 1)} cm`]
    ], [315, 184])
    const weight = content.charts[WhoIndicator.WEIGHT_FOR_AGE]
    if (weight?.length) chart(doc, weight[0]!, 'Peso para la edad · Curvas OMS', 368, 310)
    else textBlock(doc, 'Referencia OMS no disponible para este indicador.', 395)
    textBlock(doc, 'Línea azul: mediciones compartidas. Curvas OMS verificadas; edad corregida cuando corresponda.', 714, { fill: '#64748b', size: 8 })
    for (const panel of weight?.slice(1) ?? []) {
      newPage()
      chart(doc, panel, 'Peso para la edad · Otra referencia OMS', 114, 310)
      textBlock(doc, 'Línea azul: mediciones compartidas. Curvas OMS verificadas; edad corregida cuando corresponda.', 439, { fill: '#64748b', size: 8 })
    }
    newPage()
    heading(doc, 'Curvas de crecimiento OMS', 112)
    let y = 140
    doc.y = y
    for (const indicator of [WhoIndicator.HEIGHT_FOR_AGE, WhoIndicator.HEAD_CIRCUMFERENCE_FOR_AGE]) {
      const panels = content.charts[indicator]
      if (panels?.length) {
        if (y + 275 > 745) {
          newPage()
          y = 114
        }
        y = chart(doc, panels[0]!, indicator === WhoIndicator.HEIGHT_FOR_AGE ? `${panels[0]!.curves[0]!.data[0]![0] <= 730 ? 'Longitud acostada' : 'Talla de pie'} para la edad · Curvas OMS` : `${INDICATOR_LABEL[indicator]} · Curvas OMS`, y, 275) + 14
        doc.y = y
        for (const panel of panels.slice(1)) {
          if (y + 275 > 745) {
            newPage()
            y = 114
          }
          y = chart(doc, panel, indicator === WhoIndicator.HEIGHT_FOR_AGE ? `${panel.curves[0]!.data[0]![0] <= 730 ? 'Longitud acostada' : 'Talla de pie'} para la edad · Curvas OMS` : `${INDICATOR_LABEL[indicator]} · Otra referencia`, y, 275) + 14
          doc.y = y
        }
      } else {
        flowBlock(doc, INDICATOR_LABEL[indicator], 'Referencia OMS no disponible para este indicador.', primary, newPage)
        y = doc.y
      }
    }
    if (y < 710) textBlock(doc, 'Línea azul: mediciones compartidas. Curvas OMS verificadas; no se muestran interpretaciones clínicas.', y + 5, { fill: '#64748b', size: 8 })
    newPage()
    heading(doc, 'Indicaciones y próximos controles', 116)
    doc.y = 141
    for (const item of content.visits) {
      flowBlock(doc, `Control del ${date(item.measuredAt)}`, item.parentAdvice || 'No se compartieron indicaciones para este control.', primary, newPage, true)
      if (item.nextControlAt) flowBlock(doc, 'Próximo control', dateTimeFormat.format(new Date(item.nextControlAt)), primary, newPage)
    }
    if (doc.y + 75 > 745) newPage()
    heading(doc, 'Fuentes de las curvas', doc.y + 8)
    doc.y += 29
    if (!content.sources.length) doc.y = textBlock(doc, 'Referencia OMS no disponible para este informe.', doc.y)
    for (const source of content.sources) {
      if (doc.y + 55 > 745) newPage()
      doc.y = textBlock(doc, `OMS 2006 · ${source.version} · ${source.sourceUrl}`, doc.y, { size: 8, fill: '#475569' }) + 9
    }
  })
}

function summaryCell(doc: PDFKit.PDFDocument, label: string, value: string, x: number, y: number, width: number) {
  doc.font('regular').fontSize(8).fillColor('#64748b').text(label, x, y, { width })
  doc.font('bold').fontSize(9).fillColor('#0f172a').text(value, x, y + 13, { width, height: 20, ellipsis: true })
}

function table(doc: PDFKit.PDFDocument, top: number, columns: string[], rows: string[][], widths: number[]) {
  let x = 48
  for (const [index, label] of columns.entries()) {
    doc.font('regular').fontSize(8).fillColor('#64748b').text(label, x + 6, top, { width: widths[index]! - 12, lineBreak: false })
    x += widths[index]!
  }
  let y = top + 21
  for (const row of rows) {
    doc.moveTo(48, y - 3).lineTo(547, y - 3).strokeColor('#e2e8f0').lineWidth(0.6).stroke()
    x = 48
    for (const [index, cell] of row.entries()) {
      doc.font('regular').fontSize(8.5).fillColor('#0f172a').text(cell, x + 6, y + 5, { width: widths[index]! - 12, height: 18, ellipsis: true })
      x += widths[index]!
    }
    y += 29
  }
  doc.moveTo(48, y - 3).lineTo(547, y - 3).strokeColor('#e2e8f0').lineWidth(0.6).stroke()
  return y
}

export async function getDoctorPreviewPdf(actor: Actor, patientId: string, reportId: string): Promise<Buffer> {
  if (!actor.roles.includes('DOCTOR')) {
    await recordAudit('REPORT_EXPORT', 'DENIED', actor.id, patientId)
    throw createError({ statusCode: 403, statusMessage: 'Access denied' })
  }
  await authorizeClinical(actor, 'CLINICAL_READ', patientId)
  const [row] = await useDb().select({ pdfBase64: familyReport.pdfBase64 }).from(familyReport).where(and(eq(familyReport.patientId, patientId), eq(familyReport.id, reportId)))
  if (!row?.pdfBase64) throw createError({ statusCode: 404, statusMessage: 'Not found' })
  await recordAudit('REPORT_EXPORT', 'ALLOWED', actor.id, patientId)
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
  const pdf = await pdfDocument((doc) => {
    const issuedAt = new Date().toISOString()
    const newPage = () => page(doc, 'Informe clínico de crecimiento', person.name, primary, logo, issuedAt)
    const plot = (indicator: WhoIndicator, top: number, height: number) => {
      const view = growth.charts[indicator]
      if (!view) {
        flowBlock(doc, INDICATOR_LABEL[indicator], 'Referencia OMS no disponible para este indicador.', primary, newPage)
        return doc.y
      }
      return chart(doc, { ...view, curves: view.curves.map(curve => ({ data: curve.data })), points: view.points.map(point => ({ ...point, chronologicalAgeDays: point.x })) }, `${INDICATOR_LABEL[indicator]} · Curvas OMS`, top, height, true)
    }
    newPage()
    doc.roundedRect(48, 112, 499, 85, 6).fill('#f8fafc')
    summaryCell(doc, 'Paciente', person.name, 60, 122, 250)
    summaryCell(doc, 'Sexo', person.sex === 'FEMALE' ? 'Femenino' : 'Masculino', 322, 122, 210)
    summaryCell(doc, 'Nacimiento', date(person.birthDate), 60, 159, 250)
    summaryCell(doc, 'Última medición', visits[0] ? date(visits[0].measuredAt) : 'Sin controles', 322, 159, 210)
    heading(doc, 'Últimos valores', 210)
    const latest = visits[0]
    const latestResults = latest?.results.filter(result => result.parentResultId === null && result.recalculationId === null) ?? []
    if (latest) {
      const rows = latestResults.map((result) => {
        const indicator = result.indicator
        const value = indicator === WhoIndicator.HEIGHT_FOR_AGE
          ? `${decimal(latest.lengthHeightCm, 1)} cm`
          : indicator === WhoIndicator.HEAD_CIRCUMFERENCE_FOR_AGE
            ? `${decimal(latest.headCircumferenceCm, 1)} cm`
            : indicator === WhoIndicator.BMI_FOR_AGE
              ? `${decimal(latest.bmi, 2)} kg/m²`
              : `${decimal(latest.weightKg, 2)} kg`
        return [INDICATOR_LABEL[indicator as WhoIndicator], value, result.status === 'available' ? formatGrowthValues(result.z, result.percentile) : 'No disponible']
      })
      table(doc, 234, ['Indicador', 'Valor', 'Resultado'], rows.slice(0, 6), [197, 105, 197])
    } else textBlock(doc, 'Aún no hay mediciones.', 237)
    const chartTop = latest ? Math.max(445, 255 + Math.min(latestResults.length, 6) * 29) : 290
    if (growth.charts[WhoIndicator.WEIGHT_FOR_AGE]) plot(WhoIndicator.WEIGHT_FOR_AGE, chartTop, Math.min(264, 725 - chartTop))
    else textBlock(doc, 'Peso para la edad: referencia OMS no disponible.', chartTop)
    newPage()
    let y = 114
    for (const indicator of [WhoIndicator.HEIGHT_FOR_AGE, WhoIndicator.HEAD_CIRCUMFERENCE_FOR_AGE]) {
      if (growth.charts[indicator]) y = plot(indicator, y, 275) + 14
      else {
        doc.y = y
        y = plot(indicator, y, 275)
      }
      doc.y = y
    }
    if (y < 715) textBlock(doc, 'Línea azul: mediciones. Curvas −3 a +3 DE de las referencias OMS verificadas; edad corregida cuando corresponda.', y + 5, { fill: '#64748b', size: 8 })
    newPage()
    heading(doc, 'Indicaciones y próximos controles', 116)
    doc.y = 141
    for (const item of visits) {
      flowBlock(doc, `Control del ${date(item.measuredAt)}`, `Peso ${decimal(item.weightKg, 2)} kg · ${item.position === 'RECUMBENT' ? 'Longitud acostada' : 'Talla de pie'} ${decimal(item.lengthHeightCm, 1)} cm · Perímetro cefálico ${decimal(item.headCircumferenceCm, 1)} cm · IMC ${decimal(item.bmi, 2)}`, primary, newPage)
      if (item.parentAdvice) flowBlock(doc, 'Indicaciones compartidas', item.parentAdvice, primary, newPage, true)
      if (item.nextControlAt) flowBlock(doc, 'Próximo control', dateTimeFormat.format(new Date(item.nextControlAt)), primary, newPage)
      if (includePrivateNotes && item.privateNote) flowBlock(doc, 'Nota clínica privada', item.privateNote, primary, newPage)
      if (includePrivateNotes && item.clinicianTrend) flowBlock(doc, 'Tendencia clínica', item.clinicianTrend, primary, newPage)
      for (const result of item.results) {
        const detail = result.status === 'available' ? `${formatGrowthValues(result.z, result.percentile)} · ${result.classification.name ?? 'Sin nombre OMS'} · ${result.reference.ageBasis === 'CORRECTED' ? 'Edad corregida' : 'Edad cronológica'} ${result.reference.referenceAgeDays} días · OMS ${result.reference.version} · ${result.reference.sourceUrl}` : 'No disponible'
        flowBlock(doc, `${result.status === 'available' && result.recalculationId ? 'Revisión médica · ' : ''}${INDICATOR_LABEL[result.indicator as WhoIndicator]}`, detail, primary, newPage)
      }
    }
    if (doc.y + 55 > 745) newPage()
    doc.y = textBlock(doc, 'Fuente: Patrones de Crecimiento Infantil OMS 2006. Solo se muestran curvas con referencias oficiales selladas.', doc.y + 6, { fill: '#64748b', size: 8 }) + 12
    for (const indicator of [WhoIndicator.BMI_FOR_AGE, WhoIndicator.WEIGHT_FOR_LENGTH, WhoIndicator.WEIGHT_FOR_HEIGHT]) {
      if (doc.y + 290 > 745) newPage()
      if (growth.charts[indicator]) doc.y = plot(indicator, doc.y, 275) + 14
      else flowBlock(doc, INDICATOR_LABEL[indicator], 'Referencia OMS no disponible para este indicador.', primary, newPage)
    }
    if (doctor[0]?.name && doc.y + 30 < 745) textBlock(doc, `Profesional: ${doctor[0].name}`, doc.y + 12, { fill: '#475569' })
  }, includePrivateNotes)
  await recordAudit('REPORT_EXPORT', 'ALLOWED', actor.id, patientId)
  return pdf
}
