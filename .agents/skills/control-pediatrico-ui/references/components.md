# Components, routes and states

Source: board artboards `Handoff` and `NavMap`. Names were cross-checked against the Nuxt UI v4
component catalog; check detailed props/slots against the installed version before each slice.

## Component per screen

| # | Screen | Nuxt UI components | Artboard |
|---|---|---|---|
| 1 | Sign-in (email OTP) | UCard · UForm · UFormField · UInput type=email · UPinInput length=6 otp · UButton · UAlert | AuthMobile · Login1440 |
| 2 | Accept invitation | UCard · UAvatar (logo) · UCheckbox (consent) · UPinInput · UButton | AuthMobile |
| 3 | Public booking | UStepper · UCalendar · UButton (slots) · UForm · UInput · URadioGroup · USelect · UCheckbox · UPinInput | BookingMobile |
| 4 | Privacy and "Mis datos" | UPageHeader · UCard · UButton · UModal (confirm deletion) | PwaSystemMobile |
| 5 | Profile and settings | UForm · UInput · UColorModeSelect · UCheckbox (channels) · USwitch | pattern: PwaSystemMobile |
| 6 | Notification center | UTabs (Todos / Sin leer) · UCard list · UBadge · UButton variant=link | PwaSystemMobile |
| 7 | PWA: install, iOS hint, offline, splash | UBanner · UModal (iOS hint) · UEmpty | PwaSystemMobile · Icons |
| 8 | 404 · 403 · session expired | UError · UButton | PwaSystemMobile |
| 9 | Doctor home | UDashboardGroup · UDashboardSidebar · UDashboardPanel · UDashboardNavbar · UDashboardSearch · UCard · UTable · UBadge | Dashboard1440 · DoctorMobile |
| 10 | Patients | UInput (search) · UTable (clickable rows) · UAvatar · UPagination · UButton | DoctorMobile |
| 11 | Patient detail | UDashboardPanel · UCard · UBadge · UTabs · VChart · UFieldGroup (Gráfico/Tabla) · UTable · UDropdownMenu | PatientDetail1440 · Tablet1024 · DoctorMobile |
| 12 | New visit | USlideover (≥ 1024) / page (< 1024) · UForm · UInputDate · UInputNumber · URadioGroup · UTextarea · UAlert | Tablet1024 · DoctorMobile |
| 13 | New / edit patient | UForm · UInput · URadioGroup · UInputDate · UInputNumber · UTextarea · USwitch (invite to portal) · UCheckbox (extend correction) · UButton | NewPatient1440 · DoctorMobile |
| 14 | Vaccines tab | UTable grouped by age · UBadge · UModal (record dose) · UInputDate · UInput (lot) | VaccinesMilestones1440 |
| 15 | Milestones tab | UCard · age-window bar (div) · UBadge · UInputDate | VaccinesMilestones1440 |
| 16 | Agenda (day, week, month) | UTabs (Día/Semana/Mes) · custom grid · UCalendar (month) · USlideover (detail, reschedule, cancel) · UModal (new appointment) | Agenda1440 · AgendaViews1440 · AgendaMobile |
| 16.1 | Opening hours | USwitch per day · USelect (hours) · URadioGroup (duration) · blocked-days list · UInputDate | Availability1440 · AgendaMobile |
| 16.2 | Assistant (ASSISTANT) | Same agenda and hours screens, without "Abrir ficha" or clinical data | AgendaMobile (note) |
| 17 | Growth report | Doctor-approved in-page preview · `@media print` A4 · three board sections with overflow pagination · UButton (Descargar, Compartir) | ReportA4 · ReportA4p2 · ReportA4p3 |
| 18 | Parents: home | UCard per child · UBadge · UButton · bottom bar (UNavigationMenu horizontal) | ParentMobile · ParentDesktop1440 |
| 19 | Parents: child | "Ver informe" button above the tabs · UTabs · VChart (parent variant) · UCollapsible ("Ver detalles") · UCard | ParentMobile · ParentDesktop1440 |
| 20 | Parents: book appointment | USelect (child) · UCalendar · UButton (slots) · UAlert (channels) | ParentMobile |
| 21 | Initial setup wizard | UStepper · UForm · UFileUpload (logo) · UColorPicker · UInput · UCheckbox | AdminWizard1440 |
| 22 | Users | UTabs (equipo / padres) · UTable · UDropdownMenu · UModal (invite) · UBadge | AdminAudit1440 |
| 23 | Clinic settings | Same as wizard + reminder rules (USwitch, USelect), WhatsApp provider (Meta / Twilio), message preview | ClinicSettings1440 |
| 24 | Audit | UTable · USelectMenu (filters) · UInputDate range · UBadge · UTabs (data requests) | AdminAudit1440 |

## States

- **Empty:** UEmpty with a lucide icon, short title and one action ("Aún no hay mediciones" +
  "Registrar primera visita"). Never illustrations of children.
- **Loading:** USkeleton in the final shape (rows, cards, chart rectangle). No full-page spinners
  except the splash.
- **Error:** UAlert color="error" variant="soft" inside the failed block + "Reintentar". No network
  → `/sin-conexion`, never cached data.

## Navigation

Once Task 2 provides server-verified sessions, doctor and assistant: UDashboardSidebar at ≥ 1024 px
(collapsible to icons at 1024), bottom tabs on phones. Parents: bottom tabs on phones, UHeader on
desktop. Admin: sidebar. Until authentication and each route's end-to-end flow exist, keep its
navigation hidden; a hidden link is not authorization.
An ADMIN who also treats patients sees "Administración" at the end of the doctor sidebar.

| Role | Item | Route | Sub-routes |
|---|---|---|---|
| Doctor | Inicio | `/` | `#atencion`, `#controles`, `/agenda?dia=hoy` |
| Doctor | Pacientes | `/pacientes` | `/pacientes/nuevo`, `/pacientes/:id` (5 tabs), `…/:id/visitas/nueva`, `…/:id/editar`, `…/:id/informe` |
| Doctor | Agenda | `/agenda` | `?vista=dia\|semana\|mes`, `?cita=:id`, `/agenda/solicitudes`, `/agenda/horarios` |
| Doctor | Avisos | `/avisos` | |
| Doctor | Perfil | `/perfil` | |
| Assistant | Agenda | `/agenda` | `?vista=`, `/agenda/solicitudes` |
| Assistant | Horarios | `/agenda/horarios` | |
| Assistant | Perfil | `/perfil` | |
| Parents | Inicio | `/` | `/hijos/:id`, `?tab=`, `?tab=recomendaciones`, `/hijos/:id/informe` |
| Parents | Citas | `/citas` | `/citas/nueva`, `/citas/:id` |
| Parents | Avisos | `/avisos` | |
| Parents | Perfil | `/perfil` | `/perfil/recordatorios`, `/perfil/mis-datos` |
| Admin | Configuración inicial | `/admin/inicio` | `?paso=1…5` |
| Admin | Usuarios | `/admin/usuarios` | `?tab=equipo`, `?tab=padres` |
| Admin | Clínica | `/admin/clinica` | `#marca`, `#recordatorios` |
| Admin | Auditoría | `/admin/auditoria` | `?tab=solicitudes` |
| Public | Acceso | `/acceso` | `/acceso/codigo` |
| Public | Invitación | `/invitacion/:token` | `…/consentimiento`, `…/codigo` |
| Public | Reservar | `/reservar` | `/horario`, `/datos`, `/consentimiento`, `/verificar`, `/enviada` |
| Public | Sistema | | `/privacidad`, `/sin-conexion`, `/403`, `/sesion-expirada` |

Redirects: after OTP, doctor and parent → `/`; admin without a clinic → the setup wizard.
No session: `/pacientes`, `/hijos`, `/admin` → `/acceso?volver=…`.
No network: any route with data → `/sin-conexion`.

The board uses both `/admin/inicio` and `/admin/configuracion-inicial` for the wizard; pick one
during planning.
