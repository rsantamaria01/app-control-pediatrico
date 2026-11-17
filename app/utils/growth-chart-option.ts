import type { EChartsOption, LineSeriesOption } from 'echarts'
import type { ChartView, FamilyChartView } from '../../shared/utils/chart-data'
import { formatGrowthValues } from '../../shared/utils/growth-result'

export function growthChartOption(view: ChartView | FamilyChartView, dark: boolean, family: boolean, compact = false): EChartsOption {
  const color = dark
    ? { axis: '#94a3b8', grid: '#334155', median: '#e2e8f0', one: '#facc15', two: '#fb923c', three: '#f87171', patient: '#60a5fa', surface: '#0f172a', text: '#f1f5f9' }
    : { axis: '#475569', grid: '#cbd5e1', median: '#334155', one: '#a16207', two: '#c2410c', three: '#b91c1c', patient: '#1d4ed8', surface: '#ffffff', text: '#0f172a' }
  const curveSeries: LineSeriesOption[] = view.curves.map((curve, index) => ({
    type: 'line', name: family ? 'Referencia OMS' : `DE ${('label' in curve ? curve.label : '')}`, data: curve.data, showSymbol: false, silent: true, animation: false,
    lineStyle: { color: family ? index === 1 || index === 5 ? color.two : color.axis : [color.three, color.two, color.one, color.median, color.one, color.two, color.three][index],
      width: index === 3 ? 2 : 1.5, type: family ? index === 1 || index === 5 ? 'solid' : 'dotted' : index === 2 || index === 4 ? 'dashed' : 'solid' },
    ...(!family ? { endLabel: { show: true, formatter: 'label' in curve ? curve.label : '', color: color.text, fontSize: 11 } } : {})
  }))
  const range = 'band' in view ? view.band : view.curves[1]?.data.map(([x, low], index) => [x, low, view.curves[5]?.data[index]?.[1] ?? low] as [number, number, number]) ?? []
  const band: LineSeriesOption[] = [
    { type: 'line', name: 'Base de banda', data: range.map(([x, low]) => [x, low]), stack: 'rango', stackStrategy: 'all', showSymbol: false, silent: true, lineStyle: { opacity: 0 }, areaStyle: { opacity: 0 }, animation: false },
    { type: 'line', name: 'Área entre −2 y +2', data: range.map(([x, low, high]) => [x, high - low]), stack: 'rango', stackStrategy: 'all', showSymbol: false, silent: true, lineStyle: { opacity: 0 }, areaStyle: { color: dark ? '#22c55e' : '#16a34a', opacity: family ? dark ? 0.16 : 0.12 : dark ? 0.1 : 0.07 }, animation: false }
  ]
  const patient: LineSeriesOption = { type: 'line', name: 'Mediciones', data: view.points.map(point => [point.x, point.y]), z: 10, symbol: 'circle', symbolSize: 7,
    lineStyle: { color: color.patient, width: 2.5 }, itemStyle: { color: color.surface, borderColor: color.patient, borderWidth: 2 }, emphasis: { scale: 1.6 }, animation: false }
  const tooltip: EChartsOption['tooltip'] = { trigger: 'item', confine: true, backgroundColor: color.surface, textStyle: { color: color.text }, formatter: (params) => {
    const item = Array.isArray(params) ? params[0] : params
    if (!item || item.seriesName !== 'Mediciones') return ''
    const point = view.points[item.dataIndex]
    if (!point) return ''
    const date = new Intl.DateTimeFormat('es-EC', { timeZone: 'America/Guayaquil', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(point.measuredAt))
    const value = new Intl.NumberFormat('es-EC', { maximumFractionDigits: 2 }).format(point.y)
    if (family || !('z' in point)) return `${date} · ${value}${view.xUnit === 'DAY' ? ` · edad ${point.ageBasis === 'CORRECTED' ? 'corregida' : 'cronológica'} ${new Intl.NumberFormat('es-EC', { maximumFractionDigits: 1 }).format(point.x / 30.4375)} meses` : ''}`
    return `${date} · ${value} · ${point.ageBasis === 'CORRECTED' ? 'Edad corregida · ' : ''}${formatGrowthValues(point.z, point.percentile)}`
  } }
  return {
    aria: { enabled: true, description: family ? 'Mediciones y curvas de referencia de crecimiento' : 'Mediciones y siete curvas de desviación estándar OMS. Tabla disponible.' },
    textStyle: { fontFamily: 'Inter, sans-serif', color: color.text, fontSize: 11 },
    grid: { left: 14, right: family ? 14 : 44, top: 24, bottom: 65, containLabel: true },
    xAxis: { type: 'value', name: view.xUnit === 'CM' ? 'Longitud/talla (cm)' : 'Edad (meses)', min: view.curves[0]?.data[0]?.[0], max: view.curves[0]?.data.at(-1)?.[0], axisLabel: { color: color.axis, formatter: view.xUnit === 'CM' ? '{value}' : (value: number) => String(Math.round(value / 30.4375)) }, splitLine: { lineStyle: { color: color.grid, type: 'dashed' } } },
    yAxis: { type: 'value', name: view.indicator === 'BMI_FOR_AGE' ? 'kg/m²' : view.indicator === 'WEIGHT_FOR_AGE' || view.indicator === 'WEIGHT_FOR_LENGTH' || view.indicator === 'WEIGHT_FOR_HEIGHT' ? 'kg' : 'cm', axisLabel: { color: color.axis }, splitLine: { lineStyle: { color: color.grid } } },
    dataZoom: [{ type: 'inside', zoomOnMouseWheel: true, moveOnMouseMove: true }, { type: 'slider', height: 24, bottom: 4, show: !compact }],
    tooltip,
    series: [...band, ...curveSeries, patient]
  }
}
