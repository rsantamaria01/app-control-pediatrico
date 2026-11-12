---
name: control-pediatrico-ui
description: Use when building or reviewing any screen, component, chart, PDF or copy of the Control Pediátrico app (Nuxt UI pages, growth charts, Z-score chips, WHO labels, agenda, parent views, theme tokens), so the result matches the approved design board and the clinical display rules.
---

# Control Pediátrico — UI rules

## Where the design lives

- Index and screenshots: `docs/design/README.md`, `docs/design/screens/*.png`.
- Exact markup, sizes and copy: `docs/design/board/<Artboard>.dc.html` (sample data is fictional).
- Flows: `docs/design/prototype/control-pediatrico-demo.html` (secondary; board wins).
- Decisions: `docs/decisions/2026-11-10-ui-and-clinical.md` (wins over both).

Before building a screen: open its screenshot, then its `.dc.html`, then the component row for it in
`references/components.md`. Build with Nuxt UI components; do not copy the board's hand-written CSS.

## Non-negotiable rules

1. **Z without traffic lights.** Never use "Normal", "Vigilar" or generic "Riesgo" as a status.
   Show the raw Z value; use only indicator-specific WHO names from `references/clinical-labels.md`
   (including the provisional "Riesgo de sobrepeso"), subject to pediatrician demo review.
2. **Three chip tones only:** neutral (no name, inside ±2), watch (named, inside ±2: yellow + eye
   icon), flag (outside ±2: orange + triangle icon + WHO name). Color is never the only signal.
   The old `zScoreBand` green/yellow/orange/red helper does not drive the UI.
3. **Parents** see the Z value plus "dentro / fuera del rango esperado". Outside ±2 add
   "La doctora lo revisará con usted" (use the doctor's title). No alarming words. See `references/copy.md`.
4. **Chart:** seven WHO SD curves, area only between −2 and +2, end labels on each curve, patient
   line in fixed blue (`#1d4ed8` light / `#60a5fa` dark). Curves come from official WHO tables,
   never from the board's illustrative paths. See `references/growth-chart.md`.
5. **Brand:** only `primary` and the logo change per clinic. Neutral, Z colors, curve colors and the
   patient color are fixed. See `references/tokens.md`.
6. **Numbers:** `es-EC`, decimal comma, real minus sign (`Z −1,39`), tabular numerals.
   Show provisional percentiles beside Z from the same verified reference.
7. **Roles:** `ASSISTANT` never sees clinical data (no "Abrir ficha", no measurements, no Z).
8. **PDF report** never contains private clinical notes.
9. **Offline:** never show cached clinical data; route to `/sin-conexion`.
10. **Accessibility:** WCAG 2.2 AA, 44 px touch targets, visible focus, charts have a table alternative ("Ver tabla").

## References

| File | Use it for |
|---|---|
| `references/tokens.md` | `app.config.ts`, `main.css` theme, type scale, radius, spacing, white-label rule |
| `references/clinical-labels.md` | WHO names and thresholds per indicator and age, chip tone, corrected age |
| `references/growth-chart.md` | ECharts option, series styles, zoom, tooltip, parent variant |
| `references/components.md` | Nuxt UI component per screen, routes per role, empty/loading/error states |
| `references/copy.md` | Spanish copy patterns, number/date format, parent wording |

## Red flags — stop and re-check the references

- A generic "Normal", "Riesgo" or "Alerta" status next to a Z value;
  "Riesgo de sobrepeso" is a provisional indicator-specific name.
- A green/yellow/red badge with no text or icon.
- Chart colors tied to `primary`.
- Generated or hand-typed LMS / SD values.
- A clinical field visible to `ASSISTANT` or a parent seeing another family's child.
