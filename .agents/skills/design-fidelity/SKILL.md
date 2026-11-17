---
name: design-fidelity
description: Use when creating or changing any page, layout, navigation shell, form or component in app/, and always before claiming UI work done or opening a PR that touches app/.
---

# Design fidelity

The app must follow the agreed design as consolidated in `docs/design/DESIGN.md`, not a generic
Nuxt UI layout. Passing tests is not enough: a screen that works but diverges from the specification
without a documented decision is a defect.

## Sources and authority

Read these in order:

1. `docs/decisions/2026-11-10-ui-and-clinical.md` and `docs/clinical/*feedback*.md` decide **content and
   behaviour** (which fields, which sections, which wording). Example: login is username + password,
    not the historical board's email code; the quick new-patient form drops the perinatal block.
    Superseded family Z/range instructions in `control-pediatrico-ui` references MUST NOT be used.
2. `docs/design/DESIGN.md` is the **single self-contained specification** for visual language,
   role shells, navigation, route checklists, exact tokens, component patterns and current copy.
3. Current `app/` files establish implemented routes and working states, not permission to overrule
   a decision. `docs/design/board/*.dc.html`, `docs/design/screens/*.png`, `NavMap`, `Handoff`,
   `Main`, `ChartSpec` and the prototype are **historical visual references**: the accepted board
   remains the basis for shell, spacing and appearance where not superseded. Open it when a design
   detail is absent from DESIGN.md and for the corresponding screenshot comparison; use DESIGN.md
   as the routine implementation checklist, not the board's obsolete clinical or legal copy.

Preserve the specification's visual language when a decision changes content. Never copy board
sample data (patients, numbers, curves) into code; never claim an unimplemented board flow works.

Look at images when a corresponding historical artboard exists. Compare its PNG with the app
screenshot and explicitly account for superseding decisions; for a route without artboard, compare
against the DESIGN.md screen checklist and capture an app screenshot. Back the verdict with the
measurable checks below. Claude (the relay reviewer) also reviews screenshots you attach.

## Board invariants (check these first; most past deviations were here)

- **Shell, staff (doctor, assistant, admin):** `UDashboardGroup` + `UDashboardSidebar` at ≥1024 px
  (collapsible to icons at 1024), logo + clinic name at the top, icon + label nav items with count
  badges, user block (name, role, theme toggle) at the bottom. Page top bar (`UDashboardNavbar`):
  page title on the left; search, notifications bell and the primary action on the right. Admin
  items appear as an «Administración» group at the end of the doctor sidebar.
- **Shell, phone (<1024):** bottom tab bar with at most 5 items per role (doctor: Inicio,
  Pacientes, Agenda, Avisos, Perfil; assistant: Agenda, Horarios, Avisos, Perfil; guardian:
  Inicio, Citas, Avisos, Perfil; admin-only: Clínica, Catálogos). Horarios is a top-level assistant
  tab, Citas a guardian tab and Catálogos an admin-only tab; requests, invitations and doctor
  catalogs are drill-down pages, not extra phone tabs.
- **Shell, parents:** bottom tabs on phone; `UHeader` with the same horizontal items on desktop.
- **Public pages** (`/acceso`, `/reservar`, `/invitacion`, recovery): no global nav; login is
  split brand/form on desktop and compact on phone. `/privacidad` is currently linked but missing;
  do not treat the historical legal artboard as approved copy.
- **Navigation per role** comes from DESIGN.md §3 and the capability-filtered current route map,
  not the older NavMap: assistant Avisos and admin Catálogos are current, while unbuilt admin routes
  are not tabs. No duplicates or extra top-level entries. Signed-in users never see public landing.
- **Page background** is the muted surface with default cards (dark surfaces in dark theme);
  page headers use DESIGN.md's breadcrumb/title + actions pattern (e.g. new patient: breadcrumb
  left, Cancelar + primary action right in the top bar).
- **Tokens:** primary teal, semantic colours, radius, spacing and font sizes from DESIGN.md §2
  (verified against actual `app.config.ts` / `main.css`). No raw Tailwind palette colours.

## Procedure (every UI task)

1. **Map routes to specification screens.** For each route, use DESIGN.md §§3–5 to list role,
   breakpoint, theme and the historical comparison artboard in your plan; the board is not the spec.
2. **Extract a checklist from DESIGN.md** before coding: regions in order, component per region,
   approved labels/copy, sizes, spacing, badges, empty/loading/error states and dated overrides.
   Write it to `.superpowers/sdd/<plan>/fidelity/<route>.md`.
3. **Implement** using the Nuxt UI components mapped in DESIGN.md §4 and current app patterns. Use the `nuxt-ui`,
   `control-pediatrico-ui` and `modern-web-guidance` skills for component and platform details;
   the dated 14 Nov family-sharing decision and DESIGN.md override older parent Z/range copy in
   `control-pediatrico-ui` and its references.
4. **Seed fictional demo data** (`scripts/seed-demo.ts`, clearly fictional names, measurements
   computed against the real WHO tables) so screens are compared filled, not empty. Also capture
   the empty state.
5. **Capture and compare** with Playwright (max 2 workers) at 1440×900, 1024×768, 390×844,
   light and dark for affected screens:
   - Screenshot the app route in each relevant viewport/theme and compare its regions/copy with
     DESIGN.md. When an equivalent historical artboard exists, render it if necessary with
     `node docs/design/tools/render-board.cjs docs/design/board <dir>` and open both images.
   - For each equivalent artboard, run `pixelmatch` and record mismatch %, distinguishing
     intentional content/data changes from layout drift; there is no universal numeric pass
     threshold because fictional data differ. Assess region placement and structure against
     DESIGN.md, and require a cited decision for substantial visual deviation. Only when no
     comparable artboard exists, record `N/A — no equivalent artboard` instead of inventing a
     pixel percentage.
   - Add structural assertions in `test/e2e/design-fidelity.spec.ts`: sidebar at ≥1024 with
     DESIGN.md's role-specific items, phone tabs ≤5, page title/actions, no public landing when
     signed in, and correct card/region order.
6. **Fix every unexplained deviation** against DESIGN.md. An accepted difference must cite the
   decision/feedback and line; an app/ conflict with an accepted decision is a blocker, not a
   rationale to weaken the specification.
7. **Report in the PR** a fidelity table: route · historical artboard or N/A · viewport · pixel
   mismatch % or N/A · structural checks pass/fail · deviations and citations. Attach app
   screenshots and available diffs as CI artifacts (`test-results/design-fidelity/`). An
   unexplained deviation is a blocking finding.

## Red flags (stop and recheck)

- A top header with many text links for staff on desktop.
- More than 5 bottom tabs, or labels overlapping on a phone.
- A route that exists in the app but has no entry in DESIGN.md and no decision behind it.
- "Looks fine" without the app screenshot, structural checks and (where comparable) visual diff numbers.
