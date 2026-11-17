import { describe, expect, it } from 'vitest'
import { shellNavigation } from '../../server/utils/shell-navigation'

describe('server-only shell navigation contract', () => {
  it('shows no clinical or unfinished links for guests and unauthenticated clients', () => {
    expect(shellNavigation(null, ['/pacientes', '/agenda', '/admin/clinica', '/admin/catalogos'])).toEqual([])
    expect(shellNavigation(null, ['/'])).toEqual([])
  })

  it('shows only implemented doctor routes after server actor resolution', () => {
    expect(shellNavigation({ roles: ['DOCTOR'] }, ['/', '/pacientes', '/agenda', '/admin/clinica', '/admin/catalogos'])).toEqual([
      { label: 'Inicio', to: '/' },
      { label: 'Pacientes', to: '/pacientes' },
      { label: 'Agenda', to: '/agenda' }
    ])
  })

  it('never exposes clinical links to assistant or admin-only actors', () => {
    expect(shellNavigation({ roles: ['ASSISTANT'] }, ['/', '/pacientes', '/agenda', '/agenda/horarios', '/admin/clinica', '/admin/catalogos'])).toEqual([
      { label: 'Agenda', to: '/agenda' },
      { label: 'Horarios', to: '/agenda/horarios' }
    ])
    expect(shellNavigation({ roles: ['ADMIN'] }, ['/', '/pacientes', '/agenda', '/admin/clinica', '/admin/catalogos'])).toEqual([
      { label: 'Clínica', to: '/admin/clinica' },
      { label: 'Catálogos', to: '/admin/catalogos' }
    ])
  })

  it('restricts guardians to own portal routes and requires both roles for dual access', () => {
    expect(shellNavigation({ roles: ['PATIENT'] }, ['/', '/pacientes', '/citas', '/admin/clinica', '/admin/catalogos'])).toEqual([
      { label: 'Inicio', to: '/' },
      { label: 'Citas', to: '/citas' }
    ])
    expect(shellNavigation({ roles: ['DOCTOR', 'ADMIN'] }, ['/', '/pacientes', '/admin/clinica', '/admin/catalogos'])).toEqual([
      { label: 'Inicio', to: '/' },
      { label: 'Pacientes', to: '/pacientes' },
      { label: 'Clínica', to: '/admin/clinica' },
      { label: 'Catálogos', to: '/admin/catalogos' }
    ])
  })

  it('rejects unknown roles rather than treating them as staff', () => {
    expect(shellNavigation({ roles: ['DOCTOR', 'OTHER'] }, ['/', '/pacientes'])).toEqual([])
    expect(shellNavigation({ roles: ['__proto__'] }, ['/pacientes', '/admin/clinica', '/admin/catalogos'])).toEqual([])
  })

  it('ignores unimplemented paths even when actor has their role', () => {
    expect(shellNavigation({ roles: ['DOCTOR'] }, ['/pacientes', '/agenda'])).toEqual([
      { label: 'Pacientes', to: '/pacientes' },
      { label: 'Agenda', to: '/agenda' }
    ])
    expect(shellNavigation({ roles: ['ADMIN'] }, ['/pacientes', '/admin/clinica'])).toEqual([
      { label: 'Clínica', to: '/admin/clinica' }
    ])
  })

  it('rejects malformed actor role lists', () => {
    expect(shellNavigation({ roles: 'DOCTOR' } as unknown as { roles: string[] }, ['/pacientes'])).toEqual([])
  })
})
