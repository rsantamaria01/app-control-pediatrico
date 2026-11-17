# /acceso — structural fidelity checklist

References: `docs/design/board/Login1440.dc.html` (1440 × 900), `AuthMobile.dc.html` (first phone artboard, 375 × 812), `NavMap.dc.html`, and `docs/decisions/2026-11-10-ui-and-clinical.md:21` (username + password replaces the board’s email OTP).

- [ ] Public page has no global navigation or bottom tabs.
- [ ] Desktop: two side-by-side panels, left pale-teal clinic brand, growth message and footer; right centered sign-in form ≤400 px wide. Brand and form both visible at 1440; each panel at least 480 px wide.
- [ ] Phone: no left panel; clinic brand precedes the sign-in heading and form; no horizontal overflow at 390.
- [ ] Form: Spanish heading «Ingresar»; accessible «Usuario» and «Contraseña» inputs and «Ingresar» button instead of superseded email-code controls. Invitation-only copy, first-appointment booking and privacy link below.
- [ ] Successful sign-in uses a fresh seeded identity per role/viewport, shows the private shell immediately without reload, and revisiting `/acceso` redirects without displaying its sign-in form.
- [ ] Capture and visually compare app screenshots at 1440 × 900 and 390 × 844 with `Login1440.png` and the first frame of `AuthMobile.png`; record mismatch and justified copy differences. Not captured: E2E execution explicitly excluded.
