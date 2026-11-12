# WHO names and Z display

Based on the accepted 10 Nov 2026 design decisions (C2–C4) and provisional alpha choices in
`docs/superpowers/specs/2026-11-12-first-release-design.md:78-89`. Exact names, percentiles and
thresholds remain subject to pediatrician review at the alpha demo. The board `ChartSpec` table
is illustrative, not a verified WHO reference.

## Names per indicator

| Indicator | Z < −3 | Z < −2 | −2 … +2 | Z > +1 | Z > +2 | Z > +3 |
|---|---|---|---|---|---|---|
| Length/height-for-age | Talla baja severa | Talla baja | only Z | — | Talla alta para la edad | Talla alta para la edad |
| Weight-for-age | Bajo peso severo | Bajo peso | only Z | — | Revisar peso/longitud (< 2 a) o IMC/edad (≥ 2 a) | same |
| Weight-for-length/height and BMI-for-age, < 5 y | Emaciación severa | Emaciación | only Z | Riesgo de sobrepeso | Sobrepeso | Obesidad |
| BMI-for-age, ≥ 5 y | Delgadez severa | Delgadez | only Z | Sobrepeso | Obesidad | Obesidad |
| Head circumference-for-age | Microcefalia severa | Microcefalia | only Z | — | Macrocefalia | Macrocefalia |

"> +1" names are inside ±2, so they use the **watch** tone. Everything below −2 or above +2 uses
the **flag** tone. "only Z" uses the **neutral** tone and shows just `Z −1,39`.

Excess weight: weight-for-length before 2 years, BMI-for-age from 2 years.

## Sketch for `shared/utils/clinical-labels.ts` (not implemented)

```ts
export type ChipTone = 'neutral' | 'watch' | 'flag'
export interface ClinicalLabel { name: string | null, tone: ChipTone }

export function classify(indicator: WhoIndicator, rawZ: number, ageMonths: number): ClinicalLabel
```

Pin every row and exact ±2/±3 boundary with tests in Task 5. The provisional alpha choice is
strict comparisons on unrounded Z (`z < -2`, `z > 2`); equality is not outside ±2. Pediatrician
reviews this at the demo. The existing `zScoreBand` is not suitable for this display; replace it
only after Task 5's pinned tests.

## Corrected age

- Preterm (< 37 weeks): use corrected age for charts and Z until 24 months chronological.
- Extreme preterm: the doctor can extend to 36 months per patient (checkbox, suggested < 28 weeks).
- While corrected: chip "Edad corregida" and x-axis label "Edad corregida (meses)".

## Reference standards

- 0–5 years: WHO Child Growth Standards 2006 (length < 24 months recumbent, height ≥ 24 months
  standing; handle the 0.7 cm adjustment).
- 5–19 years: WHO Growth Reference 2007 (height-for-age, BMI-for-age, weight-for-age up to
  10 years) is later scope. Display `No disponible` until official rows and independent validation
  are available.
- Head circumference-for-age: WHO 2006, 0–5 years.
- Z uses LMS with the disjoint-regression cap beyond ±3 (`shared/utils/zscore.ts`, `correctZ`).

## Trend ("Cómo vienen creciendo")

Do not infer or flag trends automatically in alpha. A DOCTOR may mark a trend manually with
author attribution and audit. Pediatrician reviews any automatic criterion after the demo.
