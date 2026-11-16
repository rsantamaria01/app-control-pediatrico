import { boolean, check, index, numeric, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { catalogRelease } from './catalogs.ts'

export const vaccineDose = pgTable('vaccine_dose', {
  id: text('id').primaryKey(), patientId: text('patient_id').notNull(), releaseId: text('release_id').references(() => catalogRelease.id, { onDelete: 'restrict' }), key: text('key').notNull(), label: text('label').notNull(), doseLabel: text('dose_label'), catalogVersion: text('catalog_version').notNull(), sourcePage: text('source_page').notNull(), sourceStatus: text('source_status').notNull(), appliedAt: text('applied_at').notNull(), external: boolean('external').notNull(), lot: text('lot'), privateNote: text('private_note'), authorId: text('author_id').notNull(), createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, table => [index('vaccine_dose_patient_idx').on(table.patientId), uniqueIndex('vaccine_dose_unique_idx').on(table.patientId, table.releaseId, table.key), check('vaccine_dose_date_ck', sql`${table.appliedAt} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'`)])

export const complementaryVaccine = pgTable('complementary_vaccine', {
  id: text('id').primaryKey(), patientId: text('patient_id').notNull(), authorId: text('author_id').notNull(), label: text('label').notNull(), doseLabel: text('dose_label').notNull(), source: text('source').notNull(), status: text('status').notNull().default('DRAFT_PENDING_PEDIATRICIAN_REVIEW'), createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, table => [index('complementary_vaccine_patient_idx').on(table.patientId), check('complementary_vaccine_status_ck', sql`${table.status} = 'DRAFT_PENDING_PEDIATRICIAN_REVIEW'`)])

export const milestoneAssessment = pgTable('milestone_assessment', {
  id: text('id').primaryKey(), patientId: text('patient_id').notNull(), label: text('label').notNull(), domain: text('domain').notNull(), outcome: text('outcome').notNull(), acquiredAgeMonths: numeric('acquired_age_months'), privateNote: text('private_note'), authorId: text('author_id').notNull(), recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow()
}, table => [index('milestone_assessment_patient_idx').on(table.patientId), check('milestone_assessment_outcome_ck', sql`${table.outcome} IN ('ACHIEVED','NOT_ACHIEVED','NOT_ASSESSED')`)])

export const screeningApplication = pgTable('screening_application', {
  id: text('id').primaryKey(), patientId: text('patient_id').notNull(), category: text('category').notNull(), instrument: text('instrument').notNull(), appliedAt: text('applied_at').notNull(), result: text('result').notNull(), privateNote: text('private_note'), authorId: text('author_id').notNull(), recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow()
}, table => [index('screening_application_patient_idx').on(table.patientId)])

export const individualCheckup = pgTable('individual_checkup', {
  id: text('id').primaryKey(), patientId: text('patient_id').notNull(), date: text('date').notNull(), reason: text('reason').notNull(), authorId: text('author_id').notNull(), createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, table => [index('individual_checkup_patient_idx').on(table.patientId)])

export const completedCheckup = pgTable('completed_checkup', {
  id: text('id').primaryKey(), patientId: text('patient_id').notNull(), releaseId: text('release_id').references(() => catalogRelease.id, { onDelete: 'restrict' }), key: text('key'), individualId: text('individual_id').references(() => individualCheckup.id, { onDelete: 'restrict' }), completedAt: text('completed_at').notNull(), authorId: text('author_id').notNull(), createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, table => [index('completed_checkup_patient_idx').on(table.patientId), check('completed_checkup_target_ck', sql`(${table.individualId} IS NOT NULL) <> (${table.releaseId} IS NOT NULL AND ${table.key} IS NOT NULL)`)])
