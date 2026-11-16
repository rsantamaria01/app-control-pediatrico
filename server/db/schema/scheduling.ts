import { boolean, check, index, integer, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'
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

export const bookingProof = pgTable('booking_proof', {
  id: text('id').primaryKey(),
  email: text('email').notNull(),
  digest: text('digest').notNull(),
  kind: text('kind').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  attempts: integer('attempts').notNull().default(0)
}, table => [index('booking_proof_email_idx').on(table.email, table.kind)])

export const bookingRequest = pgTable('booking_request', {
  id: text('id').primaryKey(),
  source: text('source').notNull(),
  patientId: text('patient_id').references(() => patient.id, { onDelete: 'restrict' }),
  guardianId: text('guardian_id'),
  childName: text('child_name').notNull(),
  birthDate: text('birth_date'),
  sex: text('sex'),
  guardianName: text('guardian_name').notNull(),
  relationship: text('relationship'),
  email: text('email').notNull(),
  phone: text('phone'),
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
  status: text('status').notNull().default('PENDING'),
  consentVersion: text('consent_version').notNull(),
  consentAt: timestamp('consent_at', { withTimezone: true }).notNull().defaultNow(),
  appointmentId: text('appointment_id').references(() => appointment.id, { onDelete: 'restrict' }),
  decidedBy: text('decided_by'),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, table => [index('booking_request_pending_idx').on(table.status, table.startsAt), index('booking_request_guardian_idx').on(table.guardianId), uniqueIndex('booking_request_appointment_idx').on(table.appointmentId), check('booking_request_status_ck', sql`${table.status} IN ('PENDING','APPROVED','DECLINED')`), check('booking_request_source_ck', sql`${table.source} IN ('PUBLIC','PARENT')`)])

export const bookingNotice = pgTable('booking_notice', {
  id: text('id').primaryKey(),
  requestId: text('request_id').notNull().references(() => bookingRequest.id, { onDelete: 'restrict' }),
  status: text('status').notNull(),
  channel: text('channel').notNull().default('IN_APP'),
  delivered: boolean('delivered').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, table => [index('booking_notice_request_idx').on(table.requestId)])
