import type { Actor } from '../../shared/types/access'
import type { GrowthResult } from '../../shared/types/clinical'
import type { VisitSnapshot } from '../../shared/types/measurement'
import type { DatasetId, WhoRow } from '../../shared/types/who'
import type { ChartView, FamilyChartView, FamilyPoint, DoctorSnapshotPoint } from '../../shared/utils/chart-data'
import { buildChartData, buildFamilyChartData } from '../../shared/utils/chart-data'
import { Gender, WhoIndicator } from '../../shared/utils/enums'
import { getShareableChild } from './invitations'
import { getPatient } from './patients'
import { selectReference } from './reference-selection'
import { getWhoRows } from './who-import'
import { getVisits } from './visits'

const familyIndicators = [WhoIndicator.WEIGHT_FOR_AGE, WhoIndicator.HEIGHT_FOR_AGE, WhoIndicator.HEAD_CIRCUMFERENCE_FOR_AGE]
const doctorIndicators = [...familyIndicators, WhoIndicator.BMI_FOR_AGE, WhoIndicator.WEIGHT_FOR_LENGTH, WhoIndicator.WEIGHT_FOR_HEIGHT]

async function sealedRows(datasetId: DatasetId, indicator: WhoIndicator, sex: Gender, position: 'RECUMBENT' | 'STANDING' | null): Promise<WhoRow[]> {
  try {
    return await getWhoRows(datasetId, indicator, sex, position)
  } catch {
    return []
  }
}

export async function getDoctorGrowth(actor: Actor, patientId: string): Promise<{ name: string, charts: Partial<Record<WhoIndicator, ChartView>> }> {
  const person = await getPatient(actor, patientId)
  const visits = await getVisits(actor, patientId)
  const charts: Partial<Record<WhoIndicator, ChartView>> = {}
  for (const indicator of doctorIndicators) {
    const originals = visits.flatMap(visit => visit.results.filter(result => result.status === 'available' && result.indicator === indicator && result.parentResultId === null && result.recalculationId === null).map(result => ({ visit, result: result as GrowthResult & { status: 'available' } })))
    const last = originals[0]
    if (!last) continue
    const reference = last.result.reference
    const selection = await selectReference({ birthDate: new Date(`${person.birthDate}T00:00:00Z`), measuredAt: new Date(last.visit.measuredAt),
      gestationDays: last.visit.gestationDaysAtBirth ?? undefined, correctionUntilMonths: person.correctionUntilMonths as 24 | 36,
      measuredLengthHeightCm: last.visit.lengthHeightCm, position: last.visit.position, indicator, sex: last.result.sex })
    if ('unavailableReason' in selection || selection.datasetId !== reference.datasetId || selection.referencePosition !== reference.referencePosition) continue
    const rows = await sealedRows(reference.datasetId, indicator, last.result.sex, reference.referencePosition)
    if (!rows.length) continue
    const snapshots: DoctorSnapshotPoint[] = originals.filter(({ result }) => result.reference.datasetId === reference.datasetId && result.reference.referencePosition === reference.referencePosition)
      .map(({ visit, result }) => ({ measuredAt: visit.measuredAt, value: measurement(visit, indicator, result.reference.adjustmentCm), result }))
    const view = buildChartData(rows, snapshots)
    if (view) charts[indicator] = view
  }
  return { name: person.name, charts }
}

function measurement(visit: Pick<VisitSnapshot, 'weightKg' | 'lengthHeightCm' | 'headCircumferenceCm' | 'bmi'>, indicator: WhoIndicator, adjustment: number): number {
  if (indicator === WhoIndicator.HEIGHT_FOR_AGE) return visit.lengthHeightCm + adjustment
  if (indicator === WhoIndicator.HEAD_CIRCUMFERENCE_FOR_AGE) return visit.headCircumferenceCm
  if (indicator === WhoIndicator.BMI_FOR_AGE) return visit.bmi
  return visit.weightKg
}

export async function getFamilyGrowth(actor: Actor, patientId: string): Promise<{ name: string, charts: Partial<Record<WhoIndicator, FamilyChartView>> }> {
  const child = await getShareableChild(actor, patientId)
  const charts: Partial<Record<WhoIndicator, FamilyChartView>> = {}
  const sexRow = await (await import('../utils/db')).useDb().query.patient.findFirst({ columns: { sex: true, gestationDays: true, correctionUntilMonths: true }, where: (table, { eq }) => eq(table.id, patientId) })
  if (!sexRow || !Object.values(Gender).includes(sexRow.sex as Gender)) return { name: child.name, charts }
  const sex = sexRow.sex as Gender
  for (const indicator of familyIndicators) {
    const selected: { point: FamilyPoint, datasetId: DatasetId, position: 'RECUMBENT' | 'STANDING' | null }[] = []
    for (const visit of child.visits) {
      const ref = await selectReference({ birthDate: new Date(`${child.birthDate}T00:00:00Z`), measuredAt: new Date(visit.measuredAt), gestationDays: sexRow.gestationDays ?? undefined,
        correctionUntilMonths: sexRow.correctionUntilMonths as 24 | 36, measuredLengthHeightCm: visit.lengthHeightCm, position: visit.position as 'RECUMBENT' | 'STANDING', sex, indicator })
      if ('unavailableReason' in ref) continue
      const value = measurement({ ...visit, bmi: 0 }, indicator, ref.adjustmentCm)
      selected.push({ datasetId: ref.datasetId, position: ref.referencePosition, point: { measuredAt: visit.measuredAt, x: ref.x, y: value, ageBasis: ref.ageBasis, chronologicalAgeDays: ref.chronologicalAgeDays } })
    }
    const latest = selected[0]
    if (!latest) continue
    const rows = await sealedRows(latest.datasetId, indicator, sex, latest.position)
    const chart = buildFamilyChartData(rows, selected.filter(item => item.datasetId === latest.datasetId && item.position === latest.position).map(item => item.point))
    if (chart) charts[indicator] = chart
  }
  return { name: child.name, charts }
}
