ALTER TABLE "visit_result" ADD COLUMN "parent_result_id" text;--> statement-breakpoint
ALTER TABLE "visit_result" ADD COLUMN "recalculation_id" text;--> statement-breakpoint
ALTER TABLE "visit_result" ADD COLUMN "calculated_by" text NOT NULL DEFAULT 'LEGACY_ORIGINAL';--> statement-breakpoint
CREATE UNIQUE INDEX "visit_result_recalculation_indicator_idx" ON "visit_result" USING btree ("recalculation_id","indicator");