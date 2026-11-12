# Handoff — planning the build (for OpenCode)

Date: 12 Nov 2026 · From: Claude (design session) · To: OpenCode · Owner: Raul

## Why this PR exists

PR `design/handoff-v1` uploads the **initial reference information** from the design phase. The
pediatrician who asked for the app reviewed the interactive demo and accepted it, so the initial
design is defined.

This branch is **reference only**:

- No application code or tests were changed. The only config change is an ESLint ignore for
  `docs/design/**` (reference HTML and the screenshot script).
- It adds the design board sources and screenshots, the interactive prototype, a decision record,
  a draft UI skill and this handoff.
- `AGENTS.md` only gained pointers and a note that some rules changed; the rules themselves are
  for OpenCode to rewrite after verification.

The brainstorm and the implementation plan should be done **with OpenCode**, because it has the
project's tooling (devcontainer, database, pnpm scripts, Playwright, Hindsight bank) and the right
skills in `.agents/skills/` (`brainstorming`, `writing-plans`, `executing-plans`,
`test-driven-development`, `nuxt-ui`, `ui-ux-pro-max`, `webapp-testing`, `writing-skills`,
`verification-before-completion`).

## What to read

1. `docs/design/README.md` — index of the board, screenshots and prototype.
2. `docs/decisions/2026-11-10-ui-and-clinical.md` — product, clinical and UI decisions, plus open items.
3. `.agents/skills/control-pediatrico-ui/` — draft skill: UI rules, tokens, WHO labels, chart spec,
   component map, routes, copy.
4. `docs/handoff/ui-design.md` — the original design brief (superseded where the decisions differ).

## What OpenCode must verify before planning

The material was produced outside the repo tooling. Treat it as input, not truth:

- [ ] **Skill alignment.** Review `control-pediatrico-ui` with `writing-skills`: frontmatter, trigger
      description, length, references. Check every Nuxt UI component name and API against the
      installed `@nuxt/ui` v4 (`nuxt-ui` skill) and every ECharts option against ECharts 6.
      Fix what is wrong, then remove the "draft" line in `SKILL.md`.
- [ ] **Skill registration.** Decide whether the project skill needs an entry in `skills-lock.json`
      or in `opencode.json`, and that OpenCode actually loads it.
- [ ] **AGENTS.md.** Rewrite the domain rules that changed: roles (+ `ASSISTANT`), indicators
      (+ head circumference, WHO 2007 for 5–19 years), Z display (no traffic-light labels), clinic
      scope (all doctors see all patients). Keep the existing non-negotiables.
- [ ] **Tokens.** Confirm the proposed `app.config.ts` / `main.css` work with Nuxt UI v4 custom
      colors and the Tailwind v4 lint rules (`eslint-plugin-better-tailwindcss`).
- [ ] **zscore.ts.** `zScoreBand` (green/yellow/orange/red) no longer matches the UI. Plan the
      replacement (`clinical-labels.ts`, tests pinning every threshold) without breaking the
      existing `correctZ` tests.
- [ ] **Open items** in the decision record: trend criterion, milestone list and screening ages,
      verified MSP vaccine schedule, legal texts, ±2/±3 boundary handling. Ask Raul (who relays
      clinical questions to the pediatrician) before building those parts.
- [ ] **Data rule.** The board and prototype curves are illustrative. Plan the WHO table import
      (2006 standards + 2007 reference, length/height split, head circumference) before any chart work.

## Suggested planning flow (OpenCode)

1. `brainstorming` with Raul over the decision record and open items; confirm scope of the first
   release (the board covers more than an MVP: agenda, public booking, WhatsApp, PDF, admin).
2. Verify and fix the skill and `AGENTS.md` (checklist above) in their own small PR.
3. `writing-plans` for the build, in vertical slices, for example: foundations (tokens, layout,
   auth + roles) → WHO data + Z + labels → patients and visits → growth chart → parent portal →
   agenda and assistant → reports → reminders and WhatsApp → admin and audit → PWA polish.
4. Each slice: tests first, `pnpm lint && pnpm typecheck && pnpm test`, Playwright against the
   matching screenshot in `docs/design/screens/`.

## Notes

- The board is private to Raul: https://claude.ai/artifact/8hLyiKyAVwadFMNRKiYS7w. The repo copy
  in `docs/design/board/` is what agents should use. If the board changes, re-export the
  `.dc.html` files and re-render with `docs/design/tools/render-board.cjs`.
- WhatsApp and email credentials are secrets: admin UI or the host secrets file, never the repo.
- Hindsight bank `app-monitoreo-pediatrico` has the design decisions under
  `app-monitoreo-pediatrico/decisions/2026-11-10-*`.
