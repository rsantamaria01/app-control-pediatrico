# 2026-11-10 — UI v1 and clinical decisions

Status: accepted for the initial design (UI review closed 12 Nov 2026); C10 superseded 14 Nov 2026 as recorded below.
Sources: Raul (product owner) and the pediatrician who requested the app.
Reference: [`docs/design/`](../design/README.md).
Later clinical input: [`docs/clinical/2026-11-14-pediatrician-feedback-round-1.md`](../clinical/2026-11-14-pediatrician-feedback-round-1.md) (verbatim). Its dated decisions below override conflicting initial design and 12 Nov planning text; the original clinical source from 10 Nov remains unedited.

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
| P6 | **Superseded 12 Nov 2026 by Raul:** Sign-in for every role is username + password through Better Auth's username and email/password features, not email OTP. Email is retained for invitations and password recovery only. No self sign-up: accounts are created by invitation; staff invites follow admin authorization, and guardian invitations follow doctor/assistant verification of guardianship. Invitation links last 7 days (P7) and let the recipient choose a username and password. Usernames are case-insensitive, stored lowercase, unique, 3–32 characters from `[a-z0-9._-]`. Passwords are at least 10 characters with no composition rules; reject locally listed common/breached passwords, use Better Auth's default password hash and show a strength hint. Limit sign-in by username and IP in Valkey with progressive delay/temporary lockout and generic `Usuario o contraseña incorrectos`; audit failed attempts. Recovery accepts username or email and emails a single-use code/link valid 10 minutes, with a generic account/delivery-independent response. Admin-forced reset issues a fresh setup link; changing a password revokes other sessions. First ADMIN is bootstrapped by CLI from username + email and receives a one-time setup link, never a default password. |
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
| C10 | **Superseded 14 Nov 2026 by the pediatrician (see below):** Previously planned family Z, range wording and growth-status summaries must not ship. |

## 2026-11-14 — Pediatrician feedback, round 1 (supersedes conflicting earlier instructions)

Source: [`docs/clinical/2026-11-14-pediatrician-feedback-round-1.md`](../clinical/2026-11-14-pediatrician-feedback-round-1.md), copied verbatim from the pediatrician's WhatsApp messages via Raul. These decisions supersede C10 and conflicting family-facing copy in the initial board, skill references and 12 Nov spec/plan. Implementation is split: Part A is the Task 7 guardian-sharing correction; Part B updates the remaining planned screens and workflows, not an authorization to implement them in this documentation change.

- **C10 / Part A:** Family home, child detail and guardian API show only linked children's identity/age, the latest doctor-shared visit's date, weight, length/height and head circumference, shared indications/recommendations and optional next control. No Z, percentiles, BMI, labels, green checks, ranges, diagnoses or clinical interpretation. The doctor controls visit sharing with a toggle defaulting **on**; an unshared visit disappears from family projections; private notes never appear. Do not infer an interpretation from measurements. An approved PDF is a separately previewed/approved artifact, not an implicit extension of family home/detail; its clinical content policy needs explicit review before extending family display rules to PDFs.
- **Part B / patients:** Compact alphabetical doctor patient list: `+ Nuevo` beside the title, search by given name, surname or Ecuadorian cédula, row with name, age, latest weight and at most one small pending indicator; entire row opens the chart. Do not put diagnoses or Z on list rows. Quick patient create collects child names, surnames, birth date, sex registered at birth, Ecuadorian cédula/NUI when available, optional manually entered Hospital Santamaría record number; validate cédula format/check digit and reject duplicates with a link to the existing chart. Allow a provisional record without cédula after checking possible matches; generate the internal ID automatically. Do not require birth/perinatal history here; enter it later in the chart. Collect representative name, relationship, phone/WhatsApp (+593) and optional email; allow additional representatives and verified reuse of an existing representative account for multiple children. The optional `Invitar al portal de padres` action requires valid email, can be sent/retried later, and has visible `sin invitar` / `pendiente de activación` / `activo` states. Patient save and invitation delivery are independent: delivery failure must not lose the patient. After save open the chart. Family access stays read-only and only to approved shared information.
- **Future slice 8:** Family growth charts belong on a standalone `Crecimiento` section: verified sex/age/position-specific curves and the child's points only, without Z, percentiles, interpretation, clinical labels or status colors. No chart or growth assessment on the family home. Doctor chart retains clinician-only Z/percentiles and verified references.
- **Future slice 11:** Compact doctor home: `Hoy` with counts `Citas`, `Por confirmar`, `Atendido`, link to full agenda, and upcoming appointment time, child name, age, latest weight, reason and optional small tag; name opens the chart. `Mis pacientes` has three counted links only: `Vacunación por revisar`, `Crecimiento por revisar`, `Controles pendientes`, with drill-down rather than expanded lists. Growth-review membership is doctor-only and provisional/configurable: raw Z strictly outside ±2 **OR** absolute ΔZ ≥ 1 between the two latest comparable visits at least four weeks apart. It is a review queue, not an automatic diagnosis or family alert; pediatrician must validate criterion and configuration before definitive use.
- **Future slice 14:** Doctor vaccination-review queue includes pending Ecuador MSP **and** complementary vaccines from sourced/review-status-aware catalogs, with verified guardian WhatsApp/phone for contact; never infer unsourced doses or intervals. Do not expose contact details or clinical queue to assistants or families.
- **Future slice 15:** Doctor `Controles pendientes` queue includes a patient's past-due next control if no qualifying control has already been completed; no appointment booking is required. Keep control-due review distinct from booking requests and notifications. The AAP schedule and individualized overrides remain subject to source/review gates.

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
