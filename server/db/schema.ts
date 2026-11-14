import { bigint, boolean, check, index, integer, jsonb, numeric, pgTable, primaryKey, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  username: text('username'),
  displayUsername: text('display_username'),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow()
}, table => [uniqueIndex('user_username_lower_idx').on(sql`lower(${table.username})`)])

export const session = pgTable('session', {
  id: text('id').primaryKey(),
  expiresAt: timestamp('expires_at').notNull(),
  token: text('token').notNull().unique(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' })
}, table => [index('session_user_idx').on(table.userId)])

export const account = pgTable('account', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at'),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
  scope: text('scope'),
  password: text('password'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow()
}, table => [index('account_user_idx').on(table.userId)])

export const verification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow()
}, table => [index('verification_identifier_idx').on(table.identifier)])

export const userRole = pgTable('user_role', {
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  role: text('role').notNull()
}, table => [primaryKey({ columns: [table.userId, table.role] })])

export const auditEvent = pgTable('audit_event', {
  id: text('id').primaryKey(),
  actorId: text('actor_id'),
  action: text('action').notNull(),
  subjectId: text('subject_id'),
  outcome: text('outcome').notNull(),
  occurredAt: timestamp('occurred_at').notNull().defaultNow()
}, table => [index('audit_occurred_idx').on(table.occurredAt)])

export const setupToken = pgTable('setup_token', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  digest: text('digest').notNull().unique(),
  purpose: text('purpose').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  usedAt: timestamp('used_at')
})

export const emailHealth = pgTable('email_health', {
  id: text('id').primaryKey(),
  state: text('state').notNull(),
  updatedAt: timestamp('updated_at').notNull().defaultNow()
})

export const recoveryJob = pgTable('recovery_job', {
  id: text('id').primaryKey(),
  payload: text('payload').notNull(),
  tokenId: text('token_id'),
  deliveryPayload: text('delivery_payload'),
  forced: boolean('forced').notNull().default(false),
  state: text('state').notNull().default('QUEUED'),
  attempts: integer('attempts').notNull().default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  completedAt: timestamp('completed_at')
}, table => [index('recovery_job_pending_idx').on(table.state, table.createdAt)])

export const bootstrapMarker = pgTable('bootstrap_marker', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow()
}, table => [uniqueIndex('bootstrap_user_idx').on(table.userId)])

export const rateLimit = pgTable('rateLimit', {
  id: text('id').primaryKey(),
  key: text('key').notNull().unique(),
  count: integer('count').notNull(),
  lastRequest: bigint('lastRequest', { mode: 'number' }).notNull()
})

export const patient = pgTable('patient', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  birthDate: text('birth_date').notNull(),
  sex: text('sex').notNull(),
  gestationDays: integer('gestation_days'),
  correctionUntilMonths: integer('correction_until_months').notNull().default(24),
  birthWeightKg: numeric('birth_weight_kg'),
  birthLengthCm: numeric('birth_length_cm'),
  birthHeadCircumferenceCm: numeric('birth_head_circumference_cm'),
  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, table => [
  check('patient_sex_ck', sql`${table.sex} IN ('MALE', 'FEMALE')`),
  check('patient_correction_ck', sql`${table.correctionUntilMonths} IN (24, 36)`)
])

export const visit = pgTable('clinical_visit', {
  id: text('id').primaryKey(),
  patientId: text('patient_id').notNull().references(() => patient.id, { onDelete: 'restrict' }),
  requestId: text('request_id').notNull().unique(),
  requestDigest: text('request_digest').notNull(),
  measuredAt: timestamp('measured_at', { withTimezone: true }).notNull(),
  weightKg: numeric('weight_kg').notNull(),
  lengthHeightCm: numeric('length_height_cm').notNull(),
  position: text('position').notNull(),
  headCircumferenceCm: numeric('head_circumference_cm').notNull(),
  bmi: numeric('bmi').notNull(),
  gestationDaysAtBirth: integer('gestation_days_at_birth'),
  birthDateAtVisit: text('birth_date_at_visit').notNull(),
  sexAtVisit: text('sex_at_visit').notNull(),
  correctionUntilMonths: integer('correction_until_months').notNull(),
  authorId: text('author_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, table => [
  index('clinical_visit_patient_idx').on(table.patientId, table.measuredAt),
  check('clinical_visit_values_ck', sql`${table.weightKg} > 0 AND ${table.lengthHeightCm} > 0 AND ${table.headCircumferenceCm} > 0 AND ${table.bmi} > 0`),
  check('clinical_visit_position_ck', sql`${table.position} IN ('RECUMBENT', 'STANDING')`)
])

export const visitResult = pgTable('visit_result', {
  id: text('id').primaryKey(),
  visitId: text('visit_id').notNull().references(() => visit.id, { onDelete: 'restrict' }),
  indicator: text('indicator').notNull(),
  snapshot: jsonb('snapshot').notNull(),
  parentResultId: text('parent_result_id'),
  recalculationId: text('recalculation_id'),
  calculatedBy: text('calculated_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, table => [index('visit_result_visit_idx').on(table.visitId), uniqueIndex('visit_result_recalculation_indicator_idx').on(table.recalculationId, table.indicator)])

export const visitText = pgTable('visit_text', {
  visitId: text('visit_id').primaryKey().references(() => visit.id, { onDelete: 'restrict' }),
  privateNote: text('private_note'),
  parentAdvice: text('parent_advice'),
  clinicianTrend: text('clinician_trend')
})

export const whoDataset = pgTable('who_dataset', {
  id: text('id').primaryKey(),
  publisher: text('publisher').notNull(),
  standard: text('standard').notNull(),
  version: text('version').notNull(),
  publicationDate: text('publication_date').notNull(),
  retrievedAt: text('retrieved_at').notNull(),
  sourceUrl: text('source_url').notNull(),
  sha256: text('sha256').notNull(),
  indicator: text('indicator').notNull(),
  sex: text('sex').notNull(),
  position: text('position'),
  xUnit: text('x_unit').notNull(),
  minX: numeric('min_x').notNull(),
  maxX: numeric('max_x').notNull(),
  rowCount: integer('row_count').notNull(),
  sealed: boolean('sealed').notNull().default(false),
  importedAt: timestamp('imported_at').notNull().defaultNow()
}, table => [
  uniqueIndex('who_dataset_release_idx').on(table.version, table.indicator, table.sex, table.sourceUrl),
  check('who_dataset_standard_ck', sql`${table.publisher} = 'WHO' AND ${table.standard} = 'WHO_2006'`),
  check('who_dataset_sex_ck', sql`${table.sex} IN ('MALE', 'FEMALE')`),
  check('who_dataset_indicator_ck', sql`${table.indicator} IN ('WEIGHT_FOR_AGE', 'HEIGHT_FOR_AGE', 'WEIGHT_FOR_LENGTH', 'WEIGHT_FOR_HEIGHT', 'BMI_FOR_AGE', 'HEAD_CIRCUMFERENCE_FOR_AGE')`),
  check('who_dataset_unit_ck', sql`${table.xUnit} IN ('DAY', 'CM')`),
  check('who_dataset_position_ck', sql`${table.position} IS NULL OR ${table.position} IN ('RECUMBENT', 'STANDING')`),
  check('who_dataset_count_ck', sql`${table.rowCount} > 0 AND ${table.minX} >= 0 AND ${table.maxX} > ${table.minX}`),
  check('who_dataset_hash_ck', sql`${table.sha256} ~ '^[a-f0-9]{64}$'`)
])

export const whoReferenceRow = pgTable('who_reference_row', {
  datasetId: text('dataset_id').notNull().references(() => whoDataset.id, { onDelete: 'restrict' }),
  indicator: text('indicator').notNull(),
  sex: text('sex').notNull(),
  position: text('position'),
  xUnit: text('x_unit').notNull(),
  x: numeric('x').notNull(),
  l: numeric('l').notNull(),
  m: numeric('m').notNull(),
  s: numeric('s').notNull(),
  sdNeg3: numeric('sd_neg3').notNull(),
  sdNeg2: numeric('sd_neg2').notNull(),
  sdNeg1: numeric('sd_neg1').notNull(),
  sd0: numeric('sd_0').notNull(),
  sd1: numeric('sd_1').notNull(),
  sd2: numeric('sd_2').notNull(),
  sd3: numeric('sd_3').notNull()
}, table => [
  primaryKey({ columns: [table.datasetId, table.x] }),
  check('who_row_lms_ck', sql`${table.m} > 0 AND ${table.s} > 0 AND ${table.x} >= 0`),
  check('who_row_sd_ck', sql`${table.sdNeg3} > 0 AND ${table.sdNeg3} < ${table.sdNeg2} AND ${table.sdNeg2} < ${table.sdNeg1} AND ${table.sdNeg1} < ${table.sd0} AND ${table.sd0} < ${table.sd1} AND ${table.sd1} < ${table.sd2} AND ${table.sd2} < ${table.sd3}`),
  check('who_row_sex_ck', sql`${table.sex} IN ('MALE', 'FEMALE')`),
  check('who_row_unit_ck', sql`${table.xUnit} IN ('DAY', 'CM')`),
  check('who_row_position_ck', sql`${table.position} IS NULL OR ${table.position} IN ('RECUMBENT', 'STANDING')`)
])
