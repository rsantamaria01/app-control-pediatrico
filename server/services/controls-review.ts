import { and, desc, eq, gt, inArray } from 'drizzle-orm'
import { createError } from 'nuxt/server'
import type { Actor } from '../../shared/types/access'
import { draftBadge, draftStatus } from '../../shared/types/catalog'
import { appointment, catalogItem, catalogRelease, completedCheckup, individualCheckup, patient, visit } from '../db/schema'
import { useDb } from '../utils/db'
import { recordAudit } from './audit'

export type PendingControl = { id: string, name: string, date: string, reason: string, source: string, sourcePage: string, badge: typeof draftBadge }

function dueDate(birthDate: string, months: number, days: number | null) {
  const [year, month, day] = birthDate.split('-').map(Number)
  const date = new Date(Date.UTC(year!, month! - 1, 1))
  if (days !== null) date.setUTCDate(day! + days)
  else {
    date.setUTCMonth(date.getUTCMonth() + months)
    date.setUTCDate(Math.min(day!, new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate()))
  }
  return date.toISOString().slice(0, 10)
}

export async function listPendingControls(actor: Actor, now = new Date()): Promise<PendingControl[]> {
  if (!actor.roles.includes('DOCTOR')) {
    await recordAudit('CONTROLS_REVIEW', 'DENIED', actor.id)
    throw createError({ statusCode: 403, statusMessage: 'Access denied' })
  }
  await recordAudit('CONTROLS_REVIEW', 'ALLOWED', actor.id)
  const db = useDb()
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Guayaquil', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
  const people = await db.select({ id: patient.id, name: patient.name, birthDate: patient.birthDate }).from(patient).orderBy(patient.name)
  const releases = await db.select().from(catalogRelease).where(and(eq(catalogRelease.kind, 'CHECKUP'), eq(catalogRelease.status, draftStatus))).orderBy(desc(catalogRelease.importedAt), desc(catalogRelease.id))
  const current = new Map<string, typeof catalogRelease.$inferSelect>()
  for (const release of releases) {
    const key = JSON.stringify([release.publisher, release.version, release.url])
    if (!current.has(key)) current.set(key, release)
  }
  const result: PendingControl[] = []
  for (const person of people) {
    const visits = await db.select({ measuredAt: visit.measuredAt, nextControlAt: visit.nextControlAt }).from(visit).where(eq(visit.patientId, person.id)).orderBy(desc(visit.measuredAt), desc(visit.createdAt))
    const individual = await db.select().from(individualCheckup).where(eq(individualCheckup.patientId, person.id))
    const completed = await db.select().from(completedCheckup).where(eq(completedCheckup.patientId, person.id))
    const due: Omit<PendingControl, 'id' | 'name'>[] = []
    for (const item of individual) {
      if (item.date >= today || completed.some(row => row.individualId === item.id)) continue
      due.push({ date: item.date, reason: item.reason, source: 'Indicación médica', sourcePage: '', badge: draftBadge })
    }
    const recommended = visits.find(row => row.nextControlAt && !visits.some(later => later.measuredAt > row.measuredAt && later.measuredAt >= row.nextControlAt!))
    if (recommended?.nextControlAt) {
      const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Guayaquil', year: 'numeric', month: '2-digit', day: '2-digit' }).format(recommended.nextControlAt)
      if (date < today) due.push({ date, reason: 'Próximo control indicado en la visita', source: 'Visita médica', sourcePage: '', badge: draftBadge })
    }
    for (const release of current.values()) {
      const items = await db.select().from(catalogItem).where(and(eq(catalogItem.releaseId, release.id), eq(catalogItem.status, draftStatus)))
      for (const item of items) {
        const date = dueDate(person.birthDate, Number(item.minAgeMonths), item.minAgeDays === null ? null : Number(item.minAgeDays))
        const end = dueDate(person.birthDate, Number(item.maxAgeMonths), item.maxAgeDays === null ? null : Number(item.maxAgeDays))
        if (date >= today || end < today || completed.some(row => row.key === item.key && releases.some(previous => previous.id === row.releaseId && previous.publisher === release.publisher && previous.version === release.version && previous.url === release.url))) continue
        due.push({ date, reason: item.label, source: `${release.publisher} · ${release.title} · ${release.version}`, sourcePage: item.sourcePage, badge: draftBadge })
      }
    }
    const earliest = due.sort((a, b) => {
      const priority = (item: typeof a) => item.source === 'Visita médica' ? 0 : item.source === 'Indicación médica' ? 1 : 2
      return priority(a) - priority(b) || a.date.localeCompare(b.date)
    })[0]
    if (!earliest) continue
    const booked = await db.select({ id: appointment.id }).from(appointment).where(and(eq(appointment.patientId, person.id), inArray(appointment.status, ['PENDING', 'CONFIRMED']), gt(appointment.startsAt, now))).limit(1)
    if (!booked.length) result.push({ id: person.id, name: person.name, ...earliest })
  }
  return result
}
