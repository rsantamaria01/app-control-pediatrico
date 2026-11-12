# WHO names and Z display

Confirmed by the pediatrician on 10 Nov 2026 (`docs/decisions/2026-11-10-ui-and-clinical.md`, C2–C4).
Source table: board artboard `ChartSpec`, section "Nombres OMS por indicador".

## Names per indicator

| Indicator | Z < −3 | Z < −2 | −2 … +2 | Z > +1 | Z > +2 | Z > +3 |
|---|---|---|---|---|---|---|
| Length/height-for-age | Talla baja severa | Talla baja | only Z | — | — | — |
| Weight-for-age | Bajo peso severo | Bajo peso | only Z | — | Revisar peso/longitud (< 2 a) o IMC/edad (≥ 2 a) | same |
| Weight-for-length/height and BMI-for-age, < 5 y | Emaciación severa | Emaciación | only Z | Riesgo de sobrepeso | Sobrepeso | Obesidad |
| BMI-for-age, ≥ 5 y | Delgadez severa | Delgadez | only Z | Sobrepeso | Obesidad | Obesidad |
| Head circumference-for-age | Microcefalia | Microcefalia | only Z | — | Macrocefalia | Macrocefalia |

"> +1" names are inside ±2, so they use the **watch** tone. Everything below −2 or above +2 uses
the **flag** tone. "only Z" uses the **neutral** tone and shows just `Z −1,39`.

Excess weight: weight-for-length before 2 years, BMI-for-age from 2 years.

## Sketch for `shared/utils/clinical-labels.ts` (not implemented)

```ts
export type ChipTone = 'neutral' | 'watch' | 'flag'
export interface ClinicalLabel { name: string | null, tone: ChipTone }

// ageYears: chronological age; corrected age only feeds the chart x-axis and Z lookup.
export function clinicalLabel(indicator: Indicator, z: number, ageYears: number): ClinicalLabel
```

Pin every row of the table above with Vitest cases, including the exact boundaries. The table uses
strict comparisons (`z < -2`, `z > 2`); confirm with the pediatrician whether exactly −2,00 / +2,00
are named, and write the answer into the tests.

## Corrected age

- Preterm (< 37 weeks): use corrected age for charts and Z until 24 months chronological.
- Extreme preterm: the doctor can extend to 36 months per patient (checkbox, suggested < 28 weeks).
- While corrected: chip "Edad corregida" and x-axis label "Edad corregida (meses)".

## Reference standards

- 0–5 years: WHO Child Growth Standards 2006 (length < 24 months recumbent, height ≥ 24 months
  standing; handle the 0.7 cm adjustment).
- 5–19 years: WHO Growth Reference 2007 (height-for-age, BMI-for-age, weight-for-age up to 10 years).
- Head circumference-for-age: WHO 2006, 0–5 years.
- Z uses LMS with the disjoint-regression cap beyond ±3 (`shared/utils/zscore.ts`, `correctZ`).

## Trend ("Cómo vienen creciendo")

The doctor home lists children whose Z changes lanes between visits. The criterion is **not yet
defined**; do not invent one. Ask before implementing.
