import type { GrowthResult } from '../types/clinical'
import type { WhoRow } from '../types/who'
import { Gender, WhoIndicator } from './enums'

export type ChartCurve = { label: string, data: [number, number][] }
export type FamilyPoint = { measuredAt: string, x: number, y: number, ageBasis: 'CHRONOLOGICAL' | 'CORRECTED', chronologicalAgeDays: number }
export type DoctorPoint = Omit<FamilyPoint, 'chronologicalAgeDays'> & { z: number, percentile: number | null }
export type ChartView = { curves: ChartCurve[], band: [number, number, number][], points: DoctorPoint[], xUnit: 'DAY' | 'CM', indicator: WhoIndicator, sex: Gender }
export type FamilyChartView = { curves: { data: [number, number][] }[], points: FamilyPoint[], xUnit: 'DAY' | 'CM', indicator: WhoIndicator }
export type DoctorSnapshotPoint = { measuredAt: string, value: number, result: GrowthResult }

const columns = ['sdNeg3', 'sdNeg2', 'sdNeg1', 'sd0', 'sd1', 'sd2', 'sd3'] as const
const labels = ['−3', '−2', '−1', '0', '+1', '+2', '+3']

function verifiedRows(rows: WhoRow[]): boolean {
  if (rows.length < 2) return false
  const first = rows[0]!
  if (!Object.values(Gender).includes(first.sex) || !Object.values(WhoIndicator).includes(first.indicator) || !['DAY', 'CM'].includes(first.xUnit)) return false
  if ((first.indicator === WhoIndicator.WEIGHT_FOR_LENGTH && (first.position !== 'RECUMBENT' || first.xUnit !== 'CM'))
    || (first.indicator === WhoIndicator.WEIGHT_FOR_HEIGHT && (first.position !== 'STANDING' || first.xUnit !== 'CM'))
    || (![WhoIndicator.HEIGHT_FOR_AGE, WhoIndicator.WEIGHT_FOR_LENGTH, WhoIndicator.WEIGHT_FOR_HEIGHT].includes(first.indicator) && first.position !== null)) return false
  return rows.every((row, index) => row.indicator === first.indicator && row.sex === first.sex && row.position === first.position && row.xUnit === first.xUnit
    && Number.isFinite(row.x) && row.x >= 0 && (row.xUnit === 'CM' || row.x <= 1856)
    && (index === 0 || row.x > rows[index - 1]!.x)
    && columns.every((column, i) => Number.isFinite(row[column]) && row[column] > 0 && (i === 0 || row[column] > row[columns[i - 1]!]!)))
}

function curves(rows: WhoRow[]): ChartCurve[] {
  return columns.map((column, index) => ({ label: labels[index]!, data: rows.map(row => [row.x, row[column]]) }))
}

export function buildChartData(rows: WhoRow[], snapshots: DoctorSnapshotPoint[]): ChartView | null {
  if (!verifiedRows(rows)) return null
  const first = rows[0]!
  const points: DoctorPoint[] = []
  for (const snapshot of snapshots) {
    const { result } = snapshot
    if (result.status !== 'available') continue
    const ref = result.reference
    if (result.indicator !== first.indicator || result.sex !== first.sex || ref.standard !== 'WHO_2006' || !ref.datasetId || !ref.version
      || ref.xUnit !== first.xUnit || ref.referencePosition !== first.position || !Number.isFinite(ref.x)
      || !Number.isFinite(ref.chronologicalAgeDays) || ref.chronologicalAgeDays < 0 || ref.chronologicalAgeDays >= 1827
      || ref.x < first.x || ref.x > rows.at(-1)!.x || !Number.isFinite(snapshot.value) || !Number.isFinite(result.z)
      || !Number.isFinite(Date.parse(snapshot.measuredAt))) return null
    points.push({ measuredAt: snapshot.measuredAt, x: ref.x, y: snapshot.value, z: result.z, percentile: result.percentile, ageBasis: ref.ageBasis })
  }
  return { curves: curves(rows), band: rows.map(row => [row.x, row.sdNeg2, row.sd2]), points: points.sort((a, b) => a.x - b.x), xUnit: first.xUnit, indicator: first.indicator, sex: first.sex }
}

export function buildFamilyChartData(rows: WhoRow[], shared: FamilyPoint[]): FamilyChartView | null {
  if (!verifiedRows(rows)) return null
  const first = rows[0]!
  if (shared.some(point => !Number.isFinite(point.x) || point.x < first.x || point.x > rows.at(-1)!.x
    || !Number.isFinite(point.y) || point.y <= 0 || !Number.isFinite(Date.parse(point.measuredAt))
    || !Number.isInteger(point.chronologicalAgeDays) || point.chronologicalAgeDays < 0 || point.chronologicalAgeDays >= 1827
    || (point.ageBasis !== 'CORRECTED' && point.ageBasis !== 'CHRONOLOGICAL')
    || (first.xUnit === 'DAY' && (point.x > point.chronologicalAgeDays || (point.ageBasis === 'CHRONOLOGICAL' && point.x !== point.chronologicalAgeDays)
      || (point.ageBasis === 'CORRECTED' && point.x >= point.chronologicalAgeDays))))) return null
  return { curves: curves(rows).map(curve => ({ data: curve.data })), points: shared.map(point => ({ measuredAt: point.measuredAt, x: point.x, y: point.y, ageBasis: point.ageBasis, chronologicalAgeDays: point.chronologicalAgeDays })).sort((a, b) => a.x - b.x), xUnit: first.xUnit, indicator: first.indicator }
}
