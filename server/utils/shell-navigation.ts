type Role = 'ADMIN' | 'DOCTOR' | 'ASSISTANT' | 'PATIENT'
type Actor = { roles: string[] }
type Item = { label: string, to: string }

const entries: Record<Role, Item[]> = {
  DOCTOR: [
    { label: 'Inicio', to: '/' },
    { label: 'Pacientes', to: '/pacientes' },
    { label: 'Agenda', to: '/agenda' }
  ],
  ASSISTANT: [
    { label: 'Agenda', to: '/agenda' },
    { label: 'Horarios', to: '/agenda/horarios' }
  ],
  PATIENT: [
    { label: 'Inicio', to: '/' },
    { label: 'Citas', to: '/citas' }
  ],
  ADMIN: [{ label: 'Usuarios', to: '/admin/usuarios' }]
}

export function shellNavigation(actor: Actor | null, availableRoutes: readonly string[]): Item[] {
  if (!actor || !Array.isArray(actor.roles) || actor.roles.some(role => !(role in entries))) {
    return []
  }

  const items: Item[] = []
  for (const role of ['DOCTOR', 'ASSISTANT', 'PATIENT', 'ADMIN'] as const) {
    if (actor.roles.includes(role)) {
      for (const item of entries[role]) {
        if (availableRoutes.includes(item.to) && !items.some(existing => existing.to === item.to)) {
          items.push(item)
        }
      }
    }
  }
  return items
}
