# 2026-11-10 — UI v1 and clinical decisions

Status: accepted for the initial design (UI review closed 12 Nov 2026).
Sources: Raul (product owner) and the pediatrician who requested the app.
Reference: [`docs/design/`](../design/README.md).

These decisions override older text in `AGENTS.md`, `docs/handoff/ui-design.md` and the
original design brief where they disagree. OpenCode must verify each one during
brainstorming and turn it into tests or tasks; items under "Still open" need an answer first.

## Product and access

| # | Decision |
|---|---|
| P1 | Roles: `ADMIN`, `DOCTOR`, `ASSISTANT`, `PATIENT` (parent/guardian). `ASSISTANT` is new. |
| P2 | `ASSISTANT` manages the agenda, public booking requests and opening hours. No clinical data: no patient file, no measurements, no "Abrir ficha". |
| P3 | All doctors of a clinic see all patients of that clinic. |
| P4 | A parent only ever sees their own children (unchanged). |
| P5 | Public bookings are approved manually, by a doctor or the assistant. |
| P6 | Sign-in: email OTP, asked once per session, code valid 10 minutes. |
| P7 | Portal invitation link valid 7 days. |
| P8 | Session length: doctors (and assistants, admins) 12 h; parents 30 days. |
| P9 | WhatsApp reminders: both Meta Cloud API (preferred) and Twilio are supported. Provider and credentials are configured mainly in the admin UI; environment variables can override. Credentials are secrets: never in the repo. |
| P10 | Legal texts (privacy policy, consent, LOPDP data requests) stay as drafts until a lawyer reviews them. |
| P11 | Number format: Ecuador (`es-EC`), decimal comma (`8,20 kg`, `Z −1,39`). Z uses the real minus sign (U+2212). |
| P12 | App icon: concept A (growth curve), `docs/design/icons/concept-a-curva.svg`. |
| P13 | Theme: light and dark. White-label per clinic: only the primary color and logo change. |

## Clinical (confirmed by the pediatrician)

| # | Decision |
|---|---|
| C1 | **Corrected age** for preterm babies up to 24 months. For extreme preterm it can be extended to 36 months, per patient (checkbox, suggested when < 28 weeks). |
| C2 | **Z-scores are shown as values, without traffic-light words.** No "Normal / Vigilar / Riesgo". Show the Z value; name a result only when the WHO has a name for it. What matters: values outside ±2 SD and the growth trend. |
| C3 | **WHO names** (exact wording and thresholds in `.agents/skills/control-pediatrico-ui/references/clinical-labels.md`): talla baja / talla baja severa; bajo peso / bajo peso severo; emaciación (severa), riesgo de sobrepeso, sobrepeso, obesidad by age; "delgadez" instead of "emaciación" from 5 years; microcefalia below −2 and macrocefalia above +2. |
| C4 | High weight-for-age has no name of its own: show "Revisar peso/longitud (< 2 a) o IMC/edad (≥ 2 a)". Excess weight is judged with weight-for-length under 2 years and BMI-for-age from 2 years. |
| C5 | **Checkup schedule (AAP):** 3–5 days, 1, 2, 4, 6, 9, 12, 15, 18, 24 and 30 months, 3 years, then yearly. The doctor can add extra checkups. |
| C6 | **Vaccines:** current Ecuador MSP schedule, editable by the clinic; private vaccines; catch-up schedules. |
| C7 | **Development:** milestones in gross motor, fine motor, language, social and cognitive domains; reminders for developmental and autism (M-CHAT) screening. |
| C8 | **Growth report PDF:** curves, latest results, recommendations and medical indications. Never private clinical notes. |
| C9 | Indicators, 0–5 years (WHO 2006): length/height-for-age, weight-for-age, weight-for-length/height, BMI-for-age, **head circumference-for-age** (new). 5–19 years (WHO 2007): height-for-age, BMI-for-age, weight-for-age (up to 10 years). |
| C10 | **Parents** see the Z value plus "dentro / fuera del rango esperado" and plain language. Outside ±2 adds "La doctora lo revisará con usted" (use the doctor's title). No alarming words. Parents see growth charts for weight, height and head circumference, and the applied vaccines. |

## UI

| # | Decision |
|---|---|
| U1 | The design board is the reference (see `docs/design/README.md`); the HTML prototype is secondary. |
| U2 | Z display: neutral chip `Z −1,39` inside ±2; orange chip with triangle icon + WHO name outside ±2 (`Talla baja · −2,41`); yellow chip with eye icon for names inside ±2 (`Riesgo de sobrepeso · +1,45`). Color is never the only signal. |
| U3 | Growth chart: seven WHO SD curves, shaded area only between −2 and +2, end labels on each curve, patient line in a fixed blue that does not follow the clinic brand. |
| U4 | Agenda has day, week and month views (`?vista=dia|semana|mes`) and an opening-hours screen (`/agenda/horarios`). |

## Still open

- Exact criterion for "tendencia" (crossing percentile/Z lanes) on the doctor home.
- Final list of milestones and screening ages.
- Verified current MSP vaccine schedule (names on the board are placeholders).
- Legal texts (LOPDP) from a lawyer.
- Boundary handling at exactly ±2 / ±3 (the table uses strict `<` / `>`); confirm with the pediatrician and pin with tests.
