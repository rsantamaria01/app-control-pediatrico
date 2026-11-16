import { check, index, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { patient } from '../schema.ts'

export const clinicSchedule = pgTable('clinic_schedule', {
  id: text('id').primaryKey(),
  durationMinutes: integer('duration_minutes').notNull()
}, table => [check('clinic_schedule_duration_ck', sql`${table.durationMinutes} BETWEEN 15 AND 120`)])

export const openingHour = pgTable('opening_hour', {
  weekday: integer('weekday').primaryKey(),
  open: text('open').notNull(),
  close: text('close').notNull()
}, table => [check('opening_hour_weekday_ck', sql`${table.weekday} BETWEEN 0 AND 6`)])

export const blockedHour = pgTable('blocked_hour', {
  id: text('id').primaryKey(),
  date: text('date').notNull(),
  from: text('from_time').notNull(),
  to: text('to_time').notNull()
}, table => [index('blocked_hour_date_idx').on(table.date)])

export const appointment = pgTable('appointment', {
  id: text('id').primaryKey(),
  patientId: text('patient_id').references(() => patient.id, { onDelete: 'restrict' }),
  name: text('name').notNull(),
  contact: text('contact').notNull(),
  reason: text('reason').notNull(),
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
  endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
  timeZone: text('time_zone').notNull().default('America/Guayaquil'),
  status: text('status').notNull(),
  createdBy: text('created_by').notNull()
}, table => [index('appointment_start_idx').on(table.startsAt), check('appointment_status_ck', sql`${table.status} IN ('PENDING','CONFIRMED','ATTENDED','CANCELLED')`), check('appointment_interval_ck', sql`${table.endsAt} > ${table.startsAt}`)])
