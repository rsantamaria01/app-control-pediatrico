# Handoff — UI design phase (Claude Design session)

> **Done (12 Nov 2026).** This was the brief for the design session. The result is in
> `docs/design/`, the decisions in `docs/decisions/2026-11-10-ui-and-clinical.md` and the next
> step in `docs/handoff/planning.md`. Where this brief disagrees with them (Z labels, roles,
> indicators), they win.

Repo (public): https://github.com/rsantamaria01/app-control-pediatrico — branch `main`.
Read first: `README.md`, `AGENTS.md`, `nuxt.config.ts`, `app/app.config.ts`, `shared/utils/zscore.ts`.

## 1. What the product is
A clinical web app, installable as a PWA, for pediatric doctors to record infant
measurements and see them against the WHO Child Growth Standards (Z-scores, SD curves).
Parents get a read-only view of their own children. Context: private pediatric practice in
Guayaquil, Ecuador. UI language: Spanish (Ecuador). Working name: "Control Pediátrico"
(placeholder; brand and logo are open).

## 2. Users and roles
| Role | Main jobs | Device |
|---|---|---|
| DOCTOR | Find a patient fast, record weight/height, read the growth chart, explain it to parents | Phone/tablet in consultation, desktop at the desk |
| PATIENT (parent/guardian) | See their children's growth, read a plain-language status | Phone (installed PWA) |
| ADMIN | Manage doctor accounts and roles | Desktop |

## 3. Stack constraints the design must fit
- Nuxt 4 + **Nuxt UI v4** (Tailwind CSS v4, Reka UI). Design with Nuxt UI components so the
  coding agent can map them 1:1: `UHeader`, `UMain`, `UDashboardGroup/Sidebar/Panel`, `UCard`,
  `UTable`, `UForm` + `UFormField`, `UInput`, `UInputNumber`, `USelect`, `UTabs`, `UBadge`,
  `UModal`/`USlideover`, `UAlert`, `UEmpty`/empty states, `UColorModeButton`.
- Theme lives in `app/app.config.ts` as Nuxt UI color names (currently `primary: 'green'`,
  `neutral: 'slate'`; PWA theme color `#0f766e`). Deliver tokens in that form
  (primary/neutral + any custom palette as Tailwind v4 CSS variables in `app/assets/css/main.css`).
- Light and dark mode are both required. Mobile-first: design at 375 px and 1440 px.
- Charts: Apache ECharts (`vue-echarts`). Specify the chart style; do not design a custom
  charting engine.
- Accessibility: WCAG 2.2 AA contrast, visible focus, never rely on color alone.
- Design skill available to the coding agent later: ui-ux-pro-max (healthcare/clinic rules).

## 4. MVP screens to design
1. **Login (OTP by email)**: email field → 6-digit code entry; resend, error and expired states.
2. **Doctor home / patient list**: search by name or ID, recent patients, "Nuevo paciente".
3. **Patient detail** (core screen):
   - Header: name, sex, date of birth, age (years + months), guardians.
   - Indicator tabs: Talla para la edad · Peso para la edad · Peso para la talla · IMC para la edad.
   - Growth chart (see §5) with a toggle to a measurement table.
   - Measurement table: date, age, weight (kg), height (cm), BMI, Z per indicator with a
     color band + text label.
4. **Add measurement** (modal/slideover): date, weight (kg, 0.01), height (cm, 0.1),
   position (acostado/de pie), live Z-score preview before saving.
5. **New / edit patient**: names, sex (Masculino/Femenino), date of birth, ID document,
   guardians (name, relationship, email, phone).
6. **Parent view**: list of their children → child page with a simplified chart and a
   plain-language status per indicator (no raw Z-values by default, option to show them).
7. **Admin**: users table, invite doctor, change role, deactivate.
8. **PWA**: install banner/button ("Instalar app"), iOS hint (Compartir → Agregar a inicio),
   offline page ("Sin conexión"), app icon + splash.
9. Empty, loading and error states for each of the above.

## 5. Growth chart specification
- X axis: age in months (0–60 for the WHO 0–5 years standards) for age-based indicators;
  length/height in cm for weight-for-height. Y axis: the measured value with units.
- Background: seven WHO SD curves (−3, −2, −1, 0, +1, +2, +3). Median (0) emphasized,
  ±2 and ±3 clearly marked, shaded bands between curves.
- Patient: line + points over the curves; tooltip with date, age, value, Z-score.
- Zoom/pan on desktop; readable without zoom on a 375 px phone.
- Curves are sex-specific; show the sex label on the chart. Avoid pink/blue stereotypes.

## 6. Z-score semantics (for colors and labels)
Current code bands by |Z| (`zScoreBand` in `shared/utils/zscore.ts`):
≤1 green · ≤2 yellow · ≤3 orange · >3 red. Each badge needs a text label, e.g.
"Normal", "Vigilar", "Riesgo", "Fuera de rango". Clinical wording per indicator
(e.g. talla baja < −2 talla/edad; emaciación < −2 peso/talla; sobrepeso > +2, obesidad > +3)
should be proposed but is reviewed by the doctor before shipping.

## 7. Rules
- Use fictional patients only in mockups; no real names or data.
- No clinical data is cached on the device (affects offline screens: show "Sin conexión",
  never stale patient data).
- Spanish copy throughout; keep it short and plain for parents.
- Do not copy third-party chart artwork; a generic WHO-style chart is fine.

## 8. Out of scope for this session
Backend, database, Better Auth implementation, WHO reference data import, deployment/TLS.

## 9. What to hand back to the coding agent
1. Screen designs for the 9 items above (375 px + 1440 px, light + dark).
2. Design tokens: palette (as Nuxt UI color names / CSS variables), typography, radius, spacing.
3. Component mapping per screen to Nuxt UI components.
4. Chart style spec for ECharts (colors per SD line/band, line widths, point style, tooltip).
5. Logo/app-icon concept (SVG) to replace `public/favicon.svg` (PWA icons are generated from it).
6. Open questions for Raul (brand name, clinic branding, wording of clinical labels).

## 10. Open decisions (not yet made)
Final brand name and logo · palette · whether parents get notifications · whether doctors see
multiple clinics · exact clinical wording per Z band.
