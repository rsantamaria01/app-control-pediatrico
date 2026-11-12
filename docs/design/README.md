# Design reference — Control Pediátrico UI v1

Status: **reference only** (branch `design/handoff-v1`, 12 Nov 2026). The design was reviewed by
the pediatrician who requested the app and accepted as the initial design. Nothing in this folder
is production code. The build plan comes from OpenCode — see
[`docs/handoff/planning.md`](../handoff/planning.md).

## Sources, in order of authority

1. **The design board (primary reference).**
   Claude Design canvas: https://claude.ai/artifact/8hLyiKyAVwadFMNRKiYS7w
   The board is private to Raul. Agents cannot open it; use the copies in this folder.
2. **Board sources in this repo:** [`board/`](board/). One `.dc.html` file per artboard plus
   `canvas.json` (titles and positions). These are the exact files published to the board.
   Each artboard is HTML + inline CSS with `{{hole}}` placeholders, `<sc-for>` / `<sc-if>`
   control flow and a small `renderVals()` class that builds the sample data. Read them for
   exact sizes, spacing, copy and component structure.
3. **Screenshots:** [`screens/`](screens/). Rendered locally from `board/` with
   [`tools/render-board.cjs`](tools/render-board.cjs) (Playwright, light theme unless the file
   name says `Dark`). Use them to see the layout at a glance.
4. **Interactive prototype (secondary):** [`prototype/control-pediatrico-demo.html`](prototype/control-pediatrico-demo.html).
   Single HTML file the pediatrician used to review the flows (phone and desktop, every role).
   Open it in a browser. Use it for flow and interaction behaviour, not for pixel values.
   Published copy: https://claude.ai/artifact/CA3oh6MDARr1cpEGV8NqBv (private).

When the board and the prototype disagree, the board wins. When either disagrees with
[`docs/decisions/2026-11-10-ui-and-clinical.md`](../decisions/2026-11-10-ui-and-clinical.md),
the decision record wins.

**Sample data warning.** Every patient, number and curve on the board and in the prototype is
fictional. The growth curves are illustrative shapes, not WHO data. Never copy curve paths,
LMS values or Z-scores from these files into code (AGENTS.md: reference data comes only from the
official WHO tables).

## Re-render the screenshots

```bash
# from the repo root, with Playwright's Chromium available
node docs/design/tools/render-board.cjs docs/design/board /tmp/screens
```

The renderer is a minimal stand-in for the board runtime (holes, loops, conditionals,
`<dc-import>` child artboards). It is good enough for screenshots; it is not part of the app.

## Artboards

| Area | Artboard (board/*.dc.html) | Screenshot | What it shows |
|---|---|---|---|
| Foundations | `Main` | [png](screens/Main.png) | Palette, semantic tokens, Z display, type, radius, spacing, `app.config.ts` / `main.css` |
| Foundations | `ChartSpec` | [png](screens/ChartSpec.png) | ECharts spec, series styles, WHO names per indicator, base option |
| Foundations | `GrowthChart` | [png](screens/GrowthChart.png) | Chart component (props: `variant` medico/padres, `ind` peso/talla/pc, `dark`) |
| Foundations | `Icons` | [png](screens/Icons.png) | Icon concepts A/B/C and splash (A chosen) |
| Foundations | `NavMap` | [png](screens/NavMap.png) | Navigation and routes per role |
| Foundations | `Handoff` | [png](screens/Handoff.png) | Nuxt UI component mapping per screen, decisions and open items |
| Doctor | `Dashboard1440` | [png](screens/Dashboard1440.png) | Home: today, outside ±2 SD, growth trend, pending checkups, booking requests |
| Doctor | `PatientDetail1440` | [png](screens/PatientDetail1440.png) | Patient detail, indicator cards, chart, visit side panel |
| Doctor | `Tablet1024` | [png](screens/Tablet1024.png) | Patient + new visit slideover at 1024 |
| Doctor | `DoctorMobile` | [png](screens/DoctorMobile.png) | Phone: home, patients, detail, new visit (full page), new patient |
| Doctor | `NewPatient1440` | [png](screens/NewPatient1440.png) | New patient, preterm corrected age, guardians + portal invite |
| Doctor | `VaccinesMilestones1440` | [png](screens/VaccinesMilestones1440.png) | Vaccines (MSP + private + catch-up), milestones, screenings |
| Agenda | `Agenda1440` | [png](screens/Agenda1440.png) | Week view |
| Agenda | `AgendaViews1440` | [png](screens/AgendaViews1440.png) | Month view, day list, appointment detail with reschedule |
| Agenda | `AgendaMobile` | [png](screens/AgendaMobile.png) | Phone: day, week, month, detail/reschedule, new appointment |
| Agenda | `Availability1440` | [png](screens/Availability1440.png) | Opening hours, durations, blocked days (assistant view) |
| Report | `ReportA4`, `ReportA4p2`, `ReportA4p3` | [1](screens/ReportA4.png) · [2](screens/ReportA4p2.png) · [3](screens/ReportA4p3.png) | Growth report PDF, 3 A4 pages |
| Parents | `ParentMobile` | [png](screens/ParentMobile.png) | Phone: home, child growth, vaccines/milestones/advice, book and confirmed appointment |
| Parents | `ParentDesktop1440` | [png](screens/ParentDesktop1440.png) | Child page on desktop |
| Public | `AuthMobile`, `Login1440` | [m](screens/AuthMobile.png) · [d](screens/Login1440.png) | Email OTP sign-in (error, expired), portal invitation, consent (legal draft) |
| Public | `BookingMobile` | [png](screens/BookingMobile.png) | Public booking flow |
| System | `PwaSystemMobile` | [png](screens/PwaSystemMobile.png) | Install, iOS hint, offline, notifications, privacy, errors |
| Admin | `AdminWizard1440` | [png](screens/AdminWizard1440.png) | Initial clinic setup wizard |
| Admin | `AdminAudit1440` | [png](screens/AdminAudit1440.png) | Users (doctors, assistants, parents) and audit log |
| Admin | `ClinicSettings1440` | [png](screens/ClinicSettings1440.png) | Clinic settings, reminders, WhatsApp provider |
| Dark | `PatientDetailDark`, `DoctorMobileDark`, `ParentMobileDark` | [1](screens/PatientDetailDark.png) · [2](screens/DoctorMobileDark.png) · [3](screens/ParentMobileDark.png) | Dark theme checks |

Screens marked "patrón" in the `Handoff` mapping (e.g. profile settings) are not drawn on their
own; they reuse the layout of the artboard named there.

## Icon

[`icons/concept-a-curva.svg`](icons/concept-a-curva.svg) is the chosen app icon (concept A,
growth curve). B and C are kept for the record. `public/favicon.svg` is not replaced in this
branch; the PWA icons are generated from it, so the swap belongs to the implementation plan.
