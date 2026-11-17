---
name: design-fidelity
description: Use when creating or changing any page, layout, navigation shell, form or component in app/, and always before claiming UI work done or opening a PR that touches app/ — checks every affected screen against the agreed design board in docs/design (board HTML, screenshots, NavMap) with Playwright screenshots, pixel diff and structural assertions, and records a fidelity table in the PR. Mandatory; a UI change without this check is not done.
---

# Design fidelity

The app must look like the agreed design board. Raul and the pediatrician accepted the board
(`docs/design/`), not a generic Nuxt UI layout. Passing tests is not enough: a screen that works but
does not match its artboard is a defect.

## Sources and authority

Read `docs/design/README.md` first. Order of authority:

1. `docs/decisions/2026-11-10-ui-and-clinical.md` and `docs/clinical/*feedback*.md` decide **content and
   behaviour** (which fields, which sections, which wording). Example: login is username + password,
   not the board's email code; the quick new-patient form drops the perinatal block.
2. `docs/design/board/*.dc.html` decides **visual language and structure**: shell, regions, order,
   component types, sizes, spacing, radius, colour tokens, typography, copy style. Exact values live
   in the HTML/inline CSS; read it, do not guess.
3. `docs/design/screens/*.png` are renders of the board for quick reference.
4. `docs/design/prototype/control-pediatrico-demo.html` for flows and interactions only.

When a decision changes content, keep the board's visual language for the new content (same shell,
same card style, same badge style). Never copy board sample data (patients, numbers, curves) into code.

Look at the images. Your read tool can open PNG/JPEG files (OmniRoute models declare image input in
the OpenCode config). For every screen, open the artboard PNG and your app screenshot side by side
and compare them visually, then back the verdict with the measurable checks below. Claude (the relay
reviewer) also reviews the screenshots you attach.

## Board invariants (check these first; most past deviations were here)

- **Shell, staff (doctor, assistant, admin):** `UDashboardGroup` + `UDashboardSidebar` at ≥1024 px
  (collapsible to icons at 1024), logo + clinic name at the top, icon + label nav items with count
  badges, user block (name, role, theme toggle) at the bottom. Page top bar (`UDashboardNavbar`):
  page title on the left; search, notifications bell and the primary action on the right. Admin
  items appear as an «Administración» group at the end of the doctor sidebar.
- **Shell, phone (<1024):** bottom tab bar with at most 5 items per role (doctor: Inicio,
  Pacientes, Agenda, Avisos, Perfil). Sub-pages (Solicitudes, Horarios, Citas, Invitaciones,
  Catálogos) are reached from their parent page, never as extra top-level tabs.
- **Shell, parents:** bottom tabs on phone; `UHeader` with the same horizontal items on desktop.
- **Public pages** (`/acceso`, `/reservar`, `/invitacion`, `/privacidad`): no global nav; login
  is the split layout of `Login1440` (brand panel left, form right) and `AuthMobile` on phone.
- **Navigation per role** comes from `NavMap.dc.html`. Every role's menu must equal the board's
  list (no duplicates, no extra top-level entries). Signed-in users never see the public landing.
- **Page background** is the board's muted surface with white cards; page headers use the board's
  breadcrumb/title + actions pattern (e.g. `NewPatient1440`: breadcrumb left, Cancelar + primary
  action right in the top bar).
- **Tokens:** primary teal, semantic colours, radius, spacing and font sizes from `Main.dc.html`
  (`app.config.ts` / `main.css` blocks). No raw Tailwind palette colours.

## Procedure (every UI task)

1. **Map routes to artboards.** For each route you touch, list its artboard(s) from the README
   table and `NavMap` (desktop 1440, tablet 1024, phone, dark variants). Put the list in your plan.
2. **Extract a checklist from the artboard HTML** before coding: regions in order, component per
   region, labels/copy, sizes, spacing, badges, empty/loading/error states. Write it to
   `.superpowers/sdd/<plan>/fidelity/<route>.md`.
3. **Implement** with Nuxt UI components mapped in `Handoff.dc.html`. Use the `nuxt-ui`,
   `control-pediatrico-ui` and `modern-web-guidance` skills for component and platform details.
4. **Seed fictional demo data** (`scripts/seed-demo.ts`, clearly fictional names, measurements
   computed against the real WHO tables) so screens are compared filled, not empty. Also capture
   the empty state.
5. **Capture and compare** visually (read both images) and with Playwright (max 2 workers), same viewports as the artboards
   (1440×900, 1024×768, 390×844; light and dark where an artboard exists):
   - Render the artboard: `node docs/design/tools/render-board.cjs docs/design/board <dir>`.
   - Screenshot the app route in the same viewport and theme.
   - Pixel diff (`pixelmatch`) per screen; record the mismatch %. Large differences are
     expected only where data differs; layout, shell and region placement must match.
   - Structural assertions in `test/e2e/design-fidelity.spec.ts`: sidebar present at ≥1024 with
     the board's items, bottom tabs ≤5 on phone, top bar title + actions, no public landing when
     signed in, card/region order per the checklist.
6. **Fix every unexplained deviation.** A deviation is acceptable only if a decision record or
   pediatrician feedback requires it; cite the document and line.
7. **Report in the PR** a fidelity table: route · artboard · viewport · mismatch % · structural
   checks pass/fail · deviations with justification. Attach the app screenshots and diffs as CI
   artifacts (`test-results/design-fidelity/`). An unexplained deviation is a blocking review
   finding.

## Red flags (stop and recheck)

- A top header with many text links for staff on desktop.
- More than 5 bottom tabs, or labels overlapping on a phone.
- A route that exists in the app but has no artboard and no decision behind it.
- "Looks fine" without having opened both images and without the numbers from step 5.
