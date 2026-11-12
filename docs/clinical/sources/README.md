# Ecuador MSP immunization sources (2026)

Downloaded on **2026-11-12** from the Ecuador Ministry of Public Health page referenced in `docs/clinical/2026-11-10-pediatrician-data-requirements.md`: https://www.salud.gob.ec/esquema-nacional-de-vacunacion-ecuador/

| Original file | Official source URL | SHA-256 | Size |
|---|---|---|---:|
| `msp-immunization-manual-2026.pdf` | https://www.salud.gob.ec/wp-content/uploads/2026/09/Manual-Inmunizaciones_portada_18x25cm_v2_digi.pdf | `ae01652bb3f48d40a923aca9692d815c0e7f9bfa613b6f77d86c052c61c49dd7` | 8,327,826 bytes |
| `msp-vaccination-schedule-2026.pdf` | https://www.salud.gob.ec/wp-content/uploads/2026/09/INFOGRAFIA-2026-07-VACUNACION.pdf | `a8c3b8d24f89fe6fbde8c99961eb7e6f0681e9894260338685e4b5d9b5e689b0` | 556,964 bytes |

Text extraction check (Python `pypdf` with `fonttools`, run in an ephemeral `uv run --no-project` environment; `pdftotext` was unavailable):

- Manual: 353 pages; 348 contain extractable text (about 765,149 characters). Searches find `intervalo mínimo` on PDF pages 108, 109, 111, 112, 115, 142, 153, 157 and `contraindicaciones` and `rotavirus` in multiple sections. The five pages without text require visual inspection before modeling any rules. The manual has substantial searchable text, but this check does **not** validate doses, minimum intervals, currency, or clinical completeness.
- Schedule infographic: one page, about 2,405 extractable characters. Text extraction has garbled glyphs and loses the visual alignment of ages and doses; inspect the original graphic visually. It does not give minimum-interval or catch-up rules. No schedule entries, doses, or intervals are inferred from it here.

These files are source references, **not** validated clinical data or an approved schedule. Before import or redistribution, review source terms and verify the latest effective MSP manual and schedule, reconcile discrepancies, independently validate vaccine rules and have the pediatrician review draft entries. The source page also links an October 2026 pregnancy schedule and a shortened El Niño schedule, which were not downloaded as part of this pediatric regular-schedule source task; assess applicability before using any of them.
