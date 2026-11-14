ALTER TABLE "visit_result" ALTER COLUMN "calculated_by" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "clinical_visit" ADD COLUMN "birth_date_at_visit" text;--> statement-breakpoint
ALTER TABLE "clinical_visit" ADD COLUMN "sex_at_visit" text;