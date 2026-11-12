import { describe, expect, it } from 'vitest'
import { shellNavigation } from '../../server/utils/shell-navigation'

describe('server-only shell navigation contract', () => {
  it('shows no clinical or unfinished links for guests and unauthenticated clients', () => {
    expect(shellNavigation(null, ['/pacientes', '/agenda', '/admin/usuarios'])).toEqual([])
    expect(shellNavigation(null, ['/'])).toEqual([])
  })

  it('shows only implemented doctor routes after server actor resolution', () => {
    expect(shellNavigation({ roles: ['DOCTOR'] }, ['/', '/pacientes', '/agenda', '/admin/usuarios'])).toEqual([
      { label: 'Inicio', to: '/' },
      { label: 'Pacientes', to: '/pacientes' },
      { label: 'Agenda', to: '/agenda' }
    ])
  })

  it('never exposes clinical links to assistant or admin-only actors', () => {
    expect(shellNavigation({ roles: ['ASSISTANT'] }, ['/', '/pacientes', '/agenda', '/agenda/horarios'])).toEqual([
      { label: 'Agenda', to: '/agenda' },
      { label: 'Horarios', to: '/agenda/horarios' }
    ])
    expect(shellNavigation({ roles: ['ADMIN'] }, ['/', '/pacientes', '/agenda', '/admin/usuarios'])).toEqual([
      { label: 'Usuarios', to: '/admin/usuarios' }
    ])
  })

  it('restricts guardians to own portal routes and requires both roles for dual access', () => {
    expect(shellNavigation({ roles: ['PATIENT'] }, ['/', '/pacientes', '/citas', '/admin/usuarios'])).toEqual([
      { label: 'Inicio', to: '/' },
      { label: 'Citas', to: '/citas' }
    ])
    expect(shellNavigation({ roles: ['DOCTOR', 'ADMIN'] }, ['/', '/pacientes', '/admin/usuarios'])).toEqual([
      { label: 'Inicio', to: '/' },
      { label: 'Pacientes', to: '/pacientes' },
      { label: 'Usuarios', to: '/admin/usuarios' }
    ])
  })

  it('rejects unknown roles rather than treating them as staff', () => {
    expect(shellNavigation({ roles: ['DOCTOR', 'OTHER'] }, ['/', '/pacientes'])).toEqual([])
    expect(shellNavigation({ roles: ['__proto__'] }, ['/pacientes', '/admin/usuarios'])).toEqual([])
  })

  it('ignores unimplemented paths even when actor has their role', () => {
    expect(shellNavigation({ roles: ['DOCTOR'] }, ['/pacientes', '/agenda'])).toEqual([
      { label: 'Pacientes', to: '/pacientes' },
      { label: 'Agenda', to: '/agenda' }
    ])
  })

  it('rejects malformed actor role lists', () => {
    expect(shellNavigation({ roles: 'DOCTOR' } as unknown as { roles: string[] }, ['/pacientes'])).toEqual([])
  })
})
