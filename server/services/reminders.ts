import { and, eq, lte, notExists, sql } from 'drizzle-orm'
import { completedCheckup, guardianGrant, individualCheckup, notificationOutbox, notificationPreference, user } from '../db/schema'
import { useDb } from '../utils/db'
import { queueNotification } from './outbox'

export async function scanCheckupReminders(now = new Date()): Promise<number> {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Guayaquil', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
  const db = useDb()
  const due = await db.select({ id: individualCheckup.id, guardianId: guardianGrant.guardianId, email: user.email })
    .from(individualCheckup)
    .innerJoin(guardianGrant, and(eq(guardianGrant.patientId, individualCheckup.patientId), eq(guardianGrant.status, 'ACTIVE')))
    .innerJoin(user, eq(user.id, guardianGrant.guardianId))
    .where(and(lte(individualCheckup.date, today), notExists(db.select({ id: completedCheckup.id }).from(completedCheckup).where(eq(completedCheckup.individualId, individualCheckup.id)))))
  let queued = 0
  for (const row of due) {
    const channels = ['IN_APP'] as ('IN_APP' | 'EMAIL')[]
    const [consent] = await db.select({ enabled: notificationPreference.enabled }).from(notificationPreference).where(and(eq(notificationPreference.userId, row.guardianId), eq(notificationPreference.channel, 'EMAIL')))
    if (consent?.enabled) channels.push('EMAIL')
    for (const channel of channels) {
      const inserted = await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`${row.id}:${row.guardianId}:${channel}`}))`)
        const [existing] = await tx.select({ id: notificationOutbox.id, state: notificationOutbox.state }).from(notificationOutbox).where(and(eq(notificationOutbox.eventKind, 'CHECKUP_DUE'), eq(notificationOutbox.subjectId, row.id), eq(notificationOutbox.channel, channel), eq(notificationOutbox.recipientUserId, row.guardianId)))
        if (existing && (channel !== 'EMAIL' || existing.state !== 'OPTED_OUT')) return false
        const [eligible] = await tx.select({ id: individualCheckup.id }).from(individualCheckup).innerJoin(guardianGrant, and(eq(guardianGrant.patientId, individualCheckup.patientId), eq(guardianGrant.guardianId, row.guardianId), eq(guardianGrant.status, 'ACTIVE'))).where(and(eq(individualCheckup.id, row.id), notExists(tx.select({ id: completedCheckup.id }).from(completedCheckup).where(eq(completedCheckup.individualId, row.id)))))
        if (!eligible) return false
        if (channel === 'EMAIL') {
          const [consent] = await tx.select({ enabled: notificationPreference.enabled }).from(notificationPreference).where(and(eq(notificationPreference.userId, row.guardianId), eq(notificationPreference.channel, 'EMAIL')))
          if (!consent?.enabled) return false
        }
        if (existing) {
          await tx.update(notificationOutbox).set({ state: 'QUEUED', errorClass: null }).where(and(eq(notificationOutbox.id, existing.id), eq(notificationOutbox.state, 'OPTED_OUT')))
        } else {
          await queueNotification(tx, { kind: 'CHECKUP_DUE', subjectId: row.id }, channel === 'IN_APP' ? { channel, userId: row.guardianId } : { channel, userId: row.guardianId, address: row.email })
        }
        return true
      })
      if (inserted) queued++
    }
  }
  return queued
}
