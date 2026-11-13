# Copy and formats

UI text is Spanish (Ecuador). Code, identifiers and commits stay English.

## Numbers and dates

- `Intl.NumberFormat('es-EC')`: decimal comma. Weight 2 decimals (`8,20 kg`), length and head
  circumference 1 decimal (`76,4 cm`), BMI 1 decimal (`14,0 kg/m²`), Z 2 decimals (`−1,39`, `+2,62`).
- Z uses the real minus sign U+2212 and an explicit plus sign for positive values. Show provisional
  percentiles next to Z from the same verified reference; keep family range copy centralized for
  pediatrician review at the alpha demo.
- Dates: `10 nov 2026` in lists, `Martes 10 de noviembre` in headings, times `09:15` (24 h).
- Age: `1 año 4 meses`, `7 m · corregida 5 m` for preterm babies.

## Doctor wording

- Chip inside ±2 without a name: `Z −1,39`. Card subtitle: `Dentro de ±2 DE`.
- Named: `Talla baja · −2,41`, `Riesgo de sobrepeso · +1,45`. Column header: "Clasificación OMS".
- Trend line appears only if a doctor explicitly marked it; never infer from two Z values.
- Home sections: "Citas de hoy", "Fuera de ±2 DE", "Cómo vienen creciendo", "Controles pendientes",
  "Solicitudes de reserva".

## Parent wording

- Inside: `Peso: dentro del rango esperado · Z −1,39`.
- Outside: `Talla: fuera del rango esperado · Z −2,41. La doctora lo revisará con usted.`
  Use the doctor's own title (La doctora / El doctor).
- Short explanation shown once per screen: "La puntuación Z compara con niñas de la misma edad:
  0 es el promedio; entre −2 y +2 es el rango esperado."
- No words like riesgo, alerta, anormal, peligro. No raw WHO names for parents unless the doctor
  shares them in the recommendations.

## Report (PDF)

Footer: "No incluye notas clínicas privadas · Página N de M". Preserve three A4 board sections,
but paginate beyond three pages when content overflows. Only doctor-approved shareable snapshots
may be printed. Sections: Últimos valores (Z + provisional percentil), charts, Recomendaciones,
Indicaciones médicas, Vacunas, Desarrollo, Tamizajes, Próximo control.

## Access and recovery (P6 superseded 12 Nov 2026)

- Sign-in fields: `Usuario`, `Contraseña`; action `Ingresar`. Invalid credentials, including missing/unknown account, use `Usuario o contraseña incorrectos`.
- Recovery entry: `¿Olvidó su contraseña?`; accepts username or email. Generic acknowledgment: `Si la cuenta existe, enviaremos instrucciones al correo registrado` for existing/missing accounts and successful/failed delivery. A resend action appears after cooldown.
- Invitation/setup link is valid for 7 days; the recipient chooses a 3–32 character lowercase username and a password of at least 10 characters. Show a strength hint without prescribing composition rules. Email remains required on the account but is not used to sign in.
- Never display passwords or tokens after submission. Provider readiness and delivery failures appear only in admin/audit views, not as account-existence clues in public copy.

## General

- Buttons are verbs: "Nueva visita", "Agendar cita", "Guardar cambio", "Ver informe".
- Errors say what happened and what to do without revealing account existence: `El enlace venció. Solicite uno nuevo.`
- Sample people and IDs on the board are fictional; never ship them.
