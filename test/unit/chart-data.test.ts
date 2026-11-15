import { describe, expect, it } from 'vitest'
import type { WhoRow } from '../../shared/types/who'
import type { GrowthResult } from '../../shared/types/clinical'
import { Gender, WhoIndicator } from '../../shared/utils/enums'
import { buildChartData, buildFamilyChartData } from '../../shared/utils/chart-data'

const row = (x: number): WhoRow => ({ indicator: WhoIndicator.WEIGHT_FOR_AGE, sex: Gender.FEMALE, position: null, xUnit: 'DAY', x, l: 1, m: 5, s: 0.1,
  sdNeg3: 2, sdNeg2: 3, sdNeg1: 4, sd0: 5, sd1: 6, sd2: 7, sd3: 8 })
const result: GrowthResult = { status: 'available', indicator: WhoIndicator.WEIGHT_FOR_AGE, sex: Gender.FEMALE, z: -1.39, percentile: 8.24,
  classification: { name: null, tone: 'neutral' }, reference: { datasetId: 'verified' as GrowthResult & never, standard: 'WHO_2006', version: '2006', publicationDate: '2006-01-01', sourceUrl: 'WHO', sha256: 'a'.repeat(64), ageBasis: 'CORRECTED', chronologicalAgeDays: 40, referenceAgeDays: 30, x: 30, xUnit: 'DAY', adjustmentCm: 0, referencePosition: null, position: 'RECUMBENT', gestationDays: 250, prematurityDays: 30 } }
const point = { measuredAt: '2026-02-10T12:00:00Z', value: 4.4, result }

describe('chart data projections', () => {
  it('uses all seven official SD columns and keeps clinician results in the doctor table', () => {
    const view = buildChartData([row(0), row(30)], [point])
    expect(view.curves.map(curve => curve.label)).toEqual(['−3', '−2', '−1', '0', '+1', '+2', '+3'])
    expect(view.curves[0]?.data).toEqual([[0, 2], [30, 2]])
    expect(view.curves[5]?.data).toEqual([[0, 7], [30, 7]])
    expect(view.band).toEqual([[0, 3, 7], [30, 3, 7]])
    expect(view.points[0]).toMatchObject({ x: 30, y: 4.4, z: -1.39, percentile: 8.24, ageBasis: 'CORRECTED' })
  })

  it('removes every clinical field from the family projection including excess input keys', () => {
    const view = buildFamilyChartData([row(0), row(30)], [{ ...point, x: 30, y: 4.4, z: 4, percentile: 99.9, status: 'abnormal', classification: 'danger' }])
    expect(view.points).toEqual([{ measuredAt: point.measuredAt, x: 30, y: 4.4 }])
    expect(JSON.stringify(view)).not.toMatch(/"(?:z|percentile|status|classification|result|ageBasis|sex)"|abnormal|danger/i)
    expect(view.curves).toHaveLength(7)
    expect(view.curves[0]).toEqual({ data: [[0, 2], [30, 2]] })
  })

  it('fails closed on mixed sex, position, invalid ages, or missing WHO coverage', () => {
    expect(buildChartData([row(0), { ...row(30), sex: Gender.MALE }], [point])).toBeNull()
    expect(buildChartData([row(0), row(30)], [{ ...point, result: { ...result, sex: Gender.MALE } }])).toBeNull()
    expect(buildChartData([row(0), row(30)], [{ ...point, result: { ...result, reference: { ...result.reference, x: 31 } } }])).toBeNull()
    expect(buildChartData([row(0), row(30)], [{ ...point, result: { ...result, reference: { ...result.reference, chronologicalAgeDays: 1827 } } }])).toBeNull()
    expect(buildFamilyChartData([], [{ measuredAt: point.measuredAt, x: 30, y: 4.4 }])).toBeNull()
  })
})
