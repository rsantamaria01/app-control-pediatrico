# Tokens

Source: board artboard `Main` (`docs/design/board/Main.dc.html`, `docs/design/screens/Main.png`).
The default brand scale and fixed clinical palette are in `app/app.config.ts` and
`app/assets/css/main.css`. Runtime per-clinic branding awaits clinic settings; never recolor
neutral, WHO curves or patient lines from the primary palette.

## app/app.config.ts (default)

```ts
export default defineAppConfig({
  ui: {
    colors: {
      primary: 'brand',
      neutral: 'slate'
    }
  }
})
```

## app/assets/css/main.css (excerpt; see actual stylesheet)

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
  --color-z-flag: #ea580c;    --color-z-watch: #eab308;
  --color-z-band: #16a34a;
  --color-curve-median: #334155; --color-curve-sd1: #ca8a04;
  --color-curve-sd2: #ea580c;    --color-curve-sd3: #dc2626;
  --color-patient: #1d4ed8;
}
:root { --ui-primary: var(--ui-color-primary-700); --ui-radius: .5rem; }
.dark { --ui-primary: var(--ui-color-primary-400); }
```

Nuxt UI v4 custom colors use `@theme static --color-brand-50…950` plus `ui.colors.primary`;
`--ui-primary` derives from the registered primary scale. This excerpt illustrates the default;
use the actual stylesheet for both light and dark fixed palettes.

## White-label rule

For the alpha, each independent deployment selects an existing Tailwind palette using
`NUXT_PUBLIC_CLINIC_PRIMARY` (allowlisted: `brand`, `teal`, `indigo`, `violet`, `rose`, `emerald`)
and an optional local public asset `NUXT_PUBLIC_CLINIC_LOGO` under `/branding/<name>.svg|png|webp`.
Unsupported names and paths fall back to `brand` and `/favicon.svg`. The deployment operator
supplies the actual logo file; client input is never used to choose the palette. Use shade 700
in light and 400 in dark. Arbitrary custom-color 50–950 scale generation and persisted clinic
settings belong to Task 16, after contrast review. Clinical tokens never change.

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
