# Growth chart (ECharts via vue-echarts, client-only)

Source: board artboards `ChartSpec` and `GrowthChart` (props `variant` medico|padres,
`ind` peso|talla|pc, `dark`, `tooltip`, `corrected`). The board's curves are illustrative shapes:
real curves come from the SD columns of the official WHO tables.

## Series styles

| Element | Light | Dark | Stroke |
|---|---|---|---|
| Median (0) | #334155 | #e2e8f0 | 2 px solid · parents: 1.5 px dotted |
| ±1 SD | #ca8a04 | #facc15 | 1 px dash 4/3 |
| ±2 SD | #ea580c | #fb923c | 1.5 px solid |
| ±3 SD | #dc2626 | #f87171 | 1.5 px solid |
| Area −2…+2 | #16a34a 7 % (parents 12 %) | #22c55e 10 % (parents 16 %) | stacked area between −2 and +2 only |
| Patient | #1d4ed8 | #60a5fa | 2.5 px + 7 px hollow points |
| Grid | #f1f5f9 | #1e293b | 1 px; vertical dashed |
| Axes / ticks | #cbd5e1 / #64748b | #475569 / #94a3b8 | Inter 11 px tnum |

Each curve has an end label ("+2", "−3", …) so no curve depends on color alone.
Dark curves use the 400 step for ≥ 3:1 on slate-900. Patient color never follows the clinic brand.

## Behaviour

- Axes: 0–5 years x in months; 5–19 years x in years; weight-for-length/height x in cm. y = value with unit.
- Zoom/pan: desktop and tablet `dataZoom` inside (wheel + drag) + 24 px slider and a "Restablecer
  zoom" button. 375 px: no slider; default range current age ±6 months; selector "6 m · 1 a · Todo".
- Selection: click/tap a point → emphasis (radius 5 + halo) and fixed tooltip; the same row is
  highlighted in the table.
- Tooltip: date · age (and "edad corregida" when it applies) · value with unit · Z. If the value
  has a WHO name, show the chip (e.g. "Talla baja · −2,41"). Parents: value, Z and
  "dentro / fuera del rango esperado".
- Sex chip "Niña" / "Niño" in neutral gray, never pink/blue.
- Accessibility: `aria: { enabled: true }` with a generated description; "Ver tabla" always available.
- Indicators: 0–5 y length/height, weight, weight-for-length/height, BMI, head circumference.
  5–19 y height, BMI and weight (to 10 y).
- Parents get the chart for weight, height and head circumference.

## Base option (doctor)

```js
const option = {
  aria: { enabled: true },
  textStyle: { fontFamily: 'Inter', fontSize: 11 },
  grid: { left: 48, right: 36, top: 16, bottom: 56, containLabel: true },
  xAxis: { type: 'value', name: 'Edad (meses)', min: 0, max: 24, interval: 3,
    axisLine: { lineStyle: { color: c.axis } }, splitLine: { lineStyle: { color: c.grid, type: 'dashed' } } },
  yAxis: { type: 'value', name: 'Peso (kg)', splitLine: { lineStyle: { color: c.grid } } },
  dataZoom: isDesktop ? [{ type: 'inside' }, { type: 'slider', height: 24 }] : [{ type: 'inside', zoomOnMouseWheel: false }],
  tooltip: { trigger: 'item', confine: true, borderColor: c.border, backgroundColor: c.bg, formatter: tooltipFmt },
  series: [
    ...sdBands(c), // 'line' stack + areaStyle, silent: true, symbol: 'none'
    ...SD.map(z => ({ type: 'line', name: label(z), data: curve(z), symbol: 'none', silent: true,
      lineStyle: style(z, c), endLabel: { show: true, formatter: label(z), color: color(z, c) } })),
    { type: 'line', name: 'Paciente', data: patient, symbolSize: 7, z: 10,
      lineStyle: { width: 2.5, color: c.patient }, itemStyle: { color: c.bg, borderColor: c.patient, borderWidth: 2 },
      emphasis: { scale: 1.6, itemStyle: { color: c.patient } }, selectedMode: 'single' }
  ]
}
```

`c` is the light or dark palette above. Verify option names against the installed ECharts 6 API.

## PDF report

Report page 2 renders the same chart for length/height and head circumference (`ReportA4p2`), with
light colors, no zoom and no tooltip.
