# Tokens

Source: board artboard `Main` (`docs/design/board/Main.dc.html`, `docs/design/screens/Main.png`).
Proposed values; the current `app/app.config.ts` / `app/assets/css/main.css` still hold the
scaffold defaults (`primary: 'green'`, Public Sans). Replacing them is an implementation task.

## app/app.config.ts (proposed)

```ts
export default defineAppConfig({
  ui: {
    colors: {
      primary: 'brand', // per-clinic scale, default teal
      neutral: 'slate'
    },
    button: { defaultVariants: { size: 'lg' } } // 44 px touch target
  }
})
```

## app/assets/css/main.css (proposed)

```css
@import "tailwindcss";
@import "@nuxt/ui";

@theme static {
  --font-sans: "Inter", system-ui, sans-serif;
  --color-brand-50: #f0fdfa;  --color-brand-100: #ccfbf1;
  --color-brand-200: #99f6e4; --color-brand-300: #5eead4;
  --color-brand-400: #2dd4bf; --color-brand-500: #14b8a6;
  --color-brand-600: #0d9488; --color-brand-700: #0f766e;
  --color-brand-800: #115e59; --color-brand-900: #134e4a;
  --color-brand-950: #042f2e;
  /* Z (fixed) */
  --color-z-flag: #ea580c;    --color-z-watch: #eab308;
  --color-z-band: #16a34a;    /* area −2…+2 */
  /* WHO curves + patient (fixed) */
  --color-curve-median: #334155; --color-curve-sd1: #ca8a04;
  --color-curve-sd2: #ea580c;    --color-curve-sd3: #dc2626;
  --color-patient: #1d4ed8;
}
:root { --ui-primary: var(--ui-color-primary-700); --ui-radius: .5rem; }
.dark { --ui-primary: var(--ui-color-primary-400); }
```

Verify the Nuxt UI v4 API for custom color names (`brand`) and `--ui-*` variables before using
this verbatim.

## White-label rule

Each clinic sets one primary color. Generate a 50–950 scale from it. Light theme uses step 700
with white text; if 700 does not reach 4.5:1 against white, darken until it does. Dark theme
uses step 400 with text `#042f2e`-like dark. Only primary and the logo change.

## Semantic colors

| Token | Light | Dark | Use |
|---|---|---|---|
| `--ui-bg` | #ffffff | #0f172a | Cards, panels, inputs |
| `--ui-bg-muted` | #f8fafc | #020617 | Page background |
| `--ui-bg-elevated` | #f1f5f9 | #1e293b | Active rows, code, chips |
| `--ui-border` | #e2e8f0 | #1e293b | Card and table borders |
| `--ui-border-accented` | #cbd5e1 | #334155 | Input and outline button borders |
| `--ui-text` | #0f172a | #f1f5f9 | Main text |
| `--ui-text-muted` | #475569 | #cbd5e1 | Secondary text |
| `--ui-text-dimmed` | #64748b | #94a3b8 | Metadata (≥ 4.5:1) |
| `--ui-primary` | #0f766e | #2dd4bf | Primary action, focus, active tab |

## Z chips (fixed colors, background / text)

| Tone | When | Light | Icon |
|---|---|---|---|
| neutral | inside ±2, no WHO name | #f1f5f9 / #475569 | none |
| watch | WHO name inside ±2 (riesgo de sobrepeso < 5 y; sobrepeso ≥ 5 y) | #fef9c3 / #713f12 | eye |
| flag | outside ±2 | #ffedd5 / #9a3412 | triangle-alert |

Yellow always uses dark text (#713f12).

## Type (Inter, `font-variant-numeric: tabular-nums` for values, tables, dates)

| Style | Size/line · weight |
|---|---|
| Display | 30/36 · 700 |
| H1 | 24/32 · 600 |
| H2 | 18/28 · 600 |
| H3 | 15/22 · 600 |
| Body | 14/20 · 400 (phone 15 px) |
| Value | 28 · 600 tnum |
| Caption | 12/16 · 500 |

Inputs are 16 px on phones (prevents iOS zoom).

## Radius and spacing

Radius: sm 4 · md 8 · lg 12 · xl 16 · full. Buttons and inputs 8, cards 12, sheets and modals 16,
badges full. Spacing base 4: 4, 8, 12, 16, 24, 32, 48, 64. Minimum touch target 44 px.
Surfaces use subtle borders instead of shadows.
