export const roles = ['ADMIN', 'DOCTOR', 'ASSISTANT', 'PATIENT'] as const
export type Role = typeof roles[number]
export type Capability = 'ADMINISTER' | 'AUDIT_READ' | 'CLINICAL_READ' | 'CLINICAL_WRITE' | 'SCHEDULE' | 'GUARDIAN_GRANT' | 'PORTAL_READ'
export type Actor = { id: string, roles: Role[] }
