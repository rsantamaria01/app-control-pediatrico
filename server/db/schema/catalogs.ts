import { check, index, jsonb, numeric, pgTable, primaryKey, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

export const catalogRelease = pgTable('catalog_release', {
  id: text('id').primaryKey(),
  kind: text('kind').notNull(),
  publisher: text('publisher').notNull(),
  title: text('title').notNull(),
  version: text('version').notNull(),
  publicationDate: text('publication_date'),
  sources: jsonb('sources').$type<{ file: string, url: string, sha256: string }[]>(),
  retrievedAt: text('retrieved_at').notNull(),
  url: text('url').notNull(),
  sha256: text('sha256').notNull(),
  status: text('status').notNull().default('DRAFT_PENDING_PEDIATRICIAN_REVIEW'),
  importedAt: timestamp('imported_at', { withTimezone: true }).notNull().defaultNow()
}, table => [
  uniqueIndex('catalog_release_identity_idx').on(table.kind, table.publisher, table.version, table.url),
  index('catalog_release_kind_idx').on(table.kind, table.importedAt),
  check('catalog_release_kind_ck', sql`${table.kind} IN ('MOTOR','MILESTONE','SCREENING','CHECKUP','VACCINE')`),
  check('catalog_release_draft_ck', sql`${table.status} = 'DRAFT_PENDING_PEDIATRICIAN_REVIEW'`),
  check('catalog_release_source_ck', sql`length(btrim(${table.publisher})) > 0 AND length(btrim(${table.title})) > 0 AND length(btrim(${table.version})) > 0 AND ${table.url} LIKE 'https://%' AND ${table.sha256} ~ '^[a-f0-9]{64}$'`),
  check('catalog_release_date_ck', sql`(${table.publicationDate} IS NULL OR ${table.publicationDate} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$') AND ${table.retrievedAt} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'`)
])

export const doctorCatalogEntry = pgTable('doctor_catalog_entry', {
  id: text('id').primaryKey(),
  authorId: text('author_id').notNull(),
  label: text('label').notNull(),
  domain: text('domain').notNull(),
  minAgeMonths: numeric('min_age_months').notNull(),
  maxAgeMonths: numeric('max_age_months').notNull(),
  source: text('source').notNull(),
  status: text('status').notNull().default('DRAFT_PENDING_PEDIATRICIAN_REVIEW'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, table => [
  check('doctor_catalog_draft_ck', sql`${table.status} = 'DRAFT_PENDING_PEDIATRICIAN_REVIEW'`),
  check('doctor_catalog_age_ck', sql`${table.minAgeMonths} >= 0 AND ${table.maxAgeMonths} >= ${table.minAgeMonths}`)
])

export const catalogItem = pgTable('catalog_item', {
  releaseId: text('release_id').notNull().references(() => catalogRelease.id, { onDelete: 'restrict' }),
  key: text('key').notNull(),
  label: text('label').notNull(),
  domain: text('domain').notNull(),
  minAgeMonths: numeric('min_age_months').notNull(),
  maxAgeMonths: numeric('max_age_months').notNull(),
  sourcePage: text('source_page').notNull(),
  sourcePages: jsonb('source_pages').$type<{ file: string, page: number }[]>(),
  doseNumber: numeric('dose_number'),
  recommendedAge: text('recommended_age'),
  minimumInterval: text('minimum_interval'),
  provenance: text('provenance'),
  status: text('status').notNull().default('DRAFT_PENDING_PEDIATRICIAN_REVIEW')
}, table => [
  primaryKey({ columns: [table.releaseId, table.key] }),
  check('catalog_item_draft_ck', sql`${table.status} = 'DRAFT_PENDING_PEDIATRICIAN_REVIEW'`),
  check('catalog_item_source_ck', sql`length(btrim(${table.key})) > 0 AND length(btrim(${table.label})) > 0 AND length(btrim(${table.domain})) > 0 AND length(btrim(${table.sourcePage})) > 0`),
  check('catalog_item_age_ck', sql`${table.minAgeMonths} >= 0 AND ${table.maxAgeMonths} >= ${table.minAgeMonths}`),
  check('catalog_item_dose_ck', sql`${table.doseNumber} IS NULL OR ${table.doseNumber} >= 1`)
])
