# Private shell — structural fidelity checklist

References: `docs/design/board/NavMap.dc.html:56-80`, `Login1440.dc.html` (public shell contrast), `docs/design/README.md`. Test file: `test/e2e/design-fidelity.spec.ts`. Viewports: 1440 × 900, 1024 × 768, 390 × 844.

- [ ] At ≥1024, staff sidebar shows clinic logo/name, icon + label items in board order, user/role/theme footer, and a separate page navbar with title and contextual actions. At 1024 sidebar can collapse to icons; assert href/order even if labels are hidden.
- [ ] DOCTOR: Inicio `/`, Pacientes `/pacientes`, Agenda `/agenda`, Avisos `/avisos`, Perfil `/perfil`. On home, navbar has search, Avisos bell and Nuevo paciente action.
- [ ] ASSISTANT: Agenda `/agenda`, Horarios `/agenda/horarios`, Perfil `/perfil`; no clinical navigation. Board has no assistant Avisos top-level item.
- [ ] ADMIN: Configuración inicial `/admin/inicio`, Usuarios `/admin/usuarios`, Clínica `/admin/clinica`, Auditoría `/admin/auditoria` (board target). ADMIN alone has no doctor menu; doctor+admin grouping is out of this single-role fixture.
- [ ] PATIENT: `UHeader` desktop, clinic logo/name and Inicio `/`, Citas `/citas`, Avisos `/avisos`, Perfil `/perfil` with theme and sign-out actions; no staff sidebar.
- [ ] At ≤390, doctor has five tabs, assistant three, patient four, all in board order and never >5. Admin board documents a desktop sidebar only, so mobile tests bound any rendered tab bar to ≤5 and forbid clinical/family tabs without inventing a board-prescribed admin tab list.
- [ ] Sign-in shows the role’s shell immediately, with no explicit reload or public landing. Returning to `/acceso` redirects to the authenticated destination.
- [ ] Known deviations to investigate on an authorized run: current assistant nav adds Avisos; current admin nav supplies Clínica/Catálogos but lacks Configuración inicial/Usuarios/Auditoría. Do not silently turn these into passing expectations or change product code in this task.
- [ ] Capture board/app screenshots and pixel mismatches before claiming visual fidelity; not done because test runs and browser checks were explicitly excluded.
