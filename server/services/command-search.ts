import { and, asc, eq, ilike, or, sql } from 'drizzle-orm'
import type { Actor } from '../../shared/types/access'
import { guardianGrant, patient } from '../db/schema'
import { useDb } from '../utils/db'
import { shellNavigation } from '../utils/shell-navigation'

export type CommandResult = { id: string, label: string, description?: string, icon: string, to: string }
export type CommandSearchResults = { patients: CommandResult[], screens: CommandResult[], actions: CommandResult[] }

const routes = ['/', '/pacientes', '/agenda', '/agenda/horarios', '/citas', '/avisos', '/perfil', '/admin/catalogos', '/admin/clinica']
const icons: Record<string, string> = {
  '/': 'i-lucide-house', '/pacientes': 'i-lucide-users-round', '/agenda': 'i-lucide-calendar-days',
  '/agenda/horarios': 'i-lucide-clock', '/citas': 'i-lucide-calendar-days', '/avisos': 'i-lucide-bell',
  '/perfil': 'i-lucide-user-round', '/admin/catalogos': 'i-lucide-book-open', '/admin/clinica': 'i-lucide-settings'
}

export async function searchCommands(actor: Actor, query: string): Promise<CommandSearchResults> {
  const search = query.trim().replace(/\s+/g, ' ').slice(0, 100)
  const mode = search.startsWith('>') ? 'actions' : search.startsWith('@') ? 'patients' : 'all'
  const term = mode === 'all' ? search : search.slice(1).trim()
  const match = (label: string) => !term || label.toLocaleLowerCase('es-EC').includes(term.toLocaleLowerCase('es-EC'))
  const doctor = actor.roles.includes('DOCTOR')
  const assistant = actor.roles.includes('ASSISTANT') && !doctor
  const guardian = actor.roles.includes('PATIENT') && !doctor && !assistant && !actor.roles.includes('ADMIN')
  const visibleRoutes = doctor
    ? ['/', '/pacientes', '/agenda', '/avisos', '/perfil', ...(actor.roles.includes('ADMIN') ? ['/admin/clinica', '/admin/catalogos'] : [])]
    : assistant
      ? ['/agenda', '/agenda/horarios', '/avisos', '/perfil', ...(actor.roles.includes('ADMIN') ? ['/admin/clinica', '/admin/catalogos'] : [])]
      : guardian
        ? ['/', '/citas', '/avisos', '/perfil']
        : actor.roles.includes('ADMIN') ? ['/admin/clinica', '/admin/catalogos'] : []
  const screens = shellNavigation(actor, routes)
    .filter(item => mode === 'all' && visibleRoutes.includes(item.to) && match(item.label))
    .map(item => ({ id: `screen:${item.to}`, label: item.label, description: item.to === '/agenda/horarios' ? 'Agenda' : item.to.startsWith('/admin/') ? 'Administración' : undefined, icon: icons[item.to]!, to: item.to }))
  const actions: CommandResult[] = [
    ...(doctor
      ? [{ id: 'action:new-patient', label: 'Nuevo paciente', icon: 'i-lucide-user-round-plus', to: '/pacientes/nuevo' }]
      : []),
    ...(doctor || assistant
      ? [
          { id: 'action:invite', label: 'Invitar representante', icon: 'i-lucide-user-plus', to: '/representantes/invitar' },
          { id: 'action:requests', label: 'Solicitudes de citas', icon: 'i-lucide-calendar-check', to: '/agenda/solicitudes' }
        ]
      : []),
    ...(guardian ? [{ id: 'action:booking', label: 'Solicitar cita', icon: 'i-lucide-calendar-plus', to: '/citas' }] : []),
    ...(actor.roles.includes('ADMIN') ? [{ id: 'action:users', label: 'Usuarios', icon: 'i-lucide-users-round', to: '/admin/usuarios' }] : [])
  ].filter(item => mode !== 'patients' && match(item.label))

  if (mode === 'actions' || term.length < 2 || (!doctor && !assistant && !guardian)) return { patients: [], screens, actions }
  const db = useDb()
  const escaped = term.replace(/[\\%_]/g, '\\$&')
  let patients: CommandResult[] = []
  if (doctor) {
    const rows = await db.select({ id: patient.id, name: patient.name, birthDate: patient.birthDate, nationalId: patient.nationalId, hsmRecord: patient.hsmRecord }).from(patient)
      .where(or(ilike(sql`unaccent(${patient.name})`, `%${escaped}%`), ilike(patient.nationalId, `%${escaped}%`), ilike(patient.hsmRecord, `%${escaped}%`)))
      .orderBy(asc(sql`unaccent(${patient.name})`), asc(patient.id)).limit(12)
    patients = rows.map(row => ({ id: `patient:${row.id}`, label: row.name, description: `${row.birthDate} · ${row.nationalId || row.hsmRecord || 'Sin identificación'}`, icon: 'i-lucide-user-round', to: `/pacientes/${encodeURIComponent(row.id)}` }))
  } else if (assistant) {
    const rows = await db.select({ id: patient.id, name: patient.name }).from(patient)
      .where(ilike(sql`unaccent(${patient.name})`, `%${escaped}%`))
      .orderBy(asc(sql`unaccent(${patient.name})`), asc(patient.id)).limit(12)
    patients = rows.map(row => ({ id: `patient:${row.id}`, label: row.name, description: 'Contacto familiar', icon: 'i-lucide-user-round', to: `/representantes/invitar?patient=${encodeURIComponent(row.id)}` }))
  } else if (guardian) {
    const rows = await db.select({ id: patient.id, name: patient.name }).from(guardianGrant)
      .innerJoin(patient, eq(guardianGrant.patientId, patient.id))
      .where(and(eq(guardianGrant.guardianId, actor.id), eq(guardianGrant.status, 'ACTIVE'), ilike(sql`unaccent(${patient.name})`, `%${escaped}%`)))
      .orderBy(asc(sql`unaccent(${patient.name})`), asc(patient.id)).limit(12)
    patients = rows.map(row => ({ id: `child:${row.id}`, label: row.name, description: 'Mi hijo o hija', icon: 'i-lucide-user-round', to: `/hijos/${encodeURIComponent(row.id)}` }))
  }
  return { patients, screens, actions }
}
