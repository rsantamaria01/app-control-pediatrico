import type { Role } from './access'
import { z } from 'zod'

export const staffInviteSchema = z.strictObject({
  email: z.string().trim().pipe(z.email().max(254)).transform(value => value.toLowerCase()),
  name: z.string().trim().min(1).max(160),
  roles: z.array(z.enum(['ADMIN', 'DOCTOR', 'ASSISTANT'])).min(1).max(3).refine(value => new Set(value).size === value.length)
})

export type ClinicSettingsInput = { name: string, contactEmail: string, primary: 'brand' | 'teal' | 'indigo' | 'violet' | 'rose' | 'emerald', logo: string | null }
export type ClinicSettings = ClinicSettingsInput & { updatedAt: Date }
export type AuditFilter = { page: number, pageSize: number, action?: string, actorId?: string, outcome?: 'ALLOWED' | 'DENIED', from?: Date, to?: Date }
export type AuditEntry = { id: string, actorId: string | null, action: string, subjectId: string | null, outcome: string, occurredAt: Date }
export type AuditPage = { items: AuditEntry[], page: number, pageSize: number, total: number }
export type DataRequest = { id: string, requesterId: string, type: 'VIEW' | 'EXPORT' | 'DELETE', status: 'QUEUED' | 'UNDER_REVIEW' | 'CLOSED', handledBy: string | null, createdAt: Date, updatedAt: Date }
export type DataRequestPage = { items: DataRequest[], page: number, pageSize: number, total: number }
export type StaffMember = { id: string, name: string, email: string, roles: Role[], active: boolean }
