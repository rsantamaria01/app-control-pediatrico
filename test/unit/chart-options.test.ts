import { describe, expect, it } from 'vitest'
import type { ChartView, FamilyChartView } from '../../shared/utils/chart-data'
import { Gender, WhoIndicator } from '../../shared/utils/enums'
import { growthChartOption } from '../../app/utils/growth-chart-option'

const curves = ['−3', '−2', '−1', '0', '+1', '+2', '+3'].map((label, i) => ({ label, data: [[0, i + 2], [30, i + 3]] as [number, number][] }))
const doctor: ChartView = { curves, band: [[0, 3, 7], [30, 4, 8]], points: [{ measuredAt: '2026-01-01', x: 30, y: 5, z: -1.39, percentile: 8.24, ageBasis: 'CORRECTED' }], xUnit: 'DAY', indicator: WhoIndicator.WEIGHT_FOR_AGE, sex: Gender.FEMALE }
const family: FamilyChartView = { curves: curves.map(({ data }) => ({ data })), points: [
  { measuredAt: '2026-01-01', x: 30, y: 5, ageBasis: 'CORRECTED', chronologicalAgeDays: 40 },
  { measuredAt: '2026-02-01', x: 60, y: 6, ageBasis: 'CHRONOLOGICAL', chronologicalAgeDays: 60 }
], xUnit: 'DAY', indicator: WhoIndicator.WEIGHT_FOR_AGE }

describe('growth chart options', () => {
  it('fills only the −2 to +2 gap and labels each doctor curve with fixed blue patient points', () => {
    const option = growthChartOption(doctor, false, false)
    expect(option.series?.length).toBe(10)
    expect(option.series?.[1]?.data).toEqual([[0, 4], [30, 4]])
    expect(option.series?.[0]?.data).toEqual([[0, 3], [30, 4]])
    expect(option.series?.[2]?.endLabel?.formatter).toBe('−3')
    expect(option.series?.[9]?.lineStyle?.color).toBe('#1d4ed8')
    expect((option.tooltip as { formatter: (params: unknown) => string }).formatter({ seriesName: 'Mediciones', dataIndex: 0 })).toContain('Z −1,39')
  })

  it('keeps family chart options entirely free of point-derived interpretations and clinical values', () => {
    const option = growthChartOption(family, true, true)
    const serialized = JSON.stringify(option)
    expect(serialized).not.toMatch(/"(?:percentile|classification|status)"|"[+−][123]"|normal|rango|riesgo|obesidad/i)
    expect(option.xAxis?.name).toContain('corregida o cronológica')
    expect((option.tooltip as { formatter: (params: unknown) => string }).formatter({ seriesName: 'Mediciones', dataIndex: 0 })).toContain('edad corregida')
    expect((option.tooltip as { formatter: (params: unknown) => string }).formatter({ seriesName: 'Mediciones', dataIndex: 1 })).toContain('edad cronológica')
    expect(option.series?.length).toBe(8)
    expect(option.series?.[7]?.lineStyle?.color).toBe('#60a5fa')
    expect(option.series?.slice(0, 7).every(series => series.lineStyle?.color === '#94a3b8' && series.lineStyle?.type === 'dotted' && !series.areaStyle && !series.endLabel)).toBe(true)
  })

  it('keeps family reference curves neutral and unshaded in the light compact chart', () => {
    const option = growthChartOption(family, false, true, true)
    expect(option.series?.length).toBe(8)
    expect(option.series?.slice(0, 7).every(series => series.lineStyle?.color === '#475569' && !series.areaStyle && !series.endLabel)).toBe(true)
    expect(option.xAxis?.name).toContain('corregida o cronológica')
    expect(option.yAxis?.name).toBe('kg')
  })
})
