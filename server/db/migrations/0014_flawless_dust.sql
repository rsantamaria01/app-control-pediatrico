ALTER TABLE "visit_result" ALTER COLUMN "calculated_by" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "clinical_visit" ADD COLUMN "birth_date_at_visit" text;--> statement-breakpoint
ALTER TABLE "clinical_visit" ADD COLUMN "sex_at_visit" text;--> statement-breakpoint
UPDATE "clinical_visit" AS v SET "birth_date_at_visit" = p."birth_date", "sex_at_visit" = p."sex" FROM "patient" AS p WHERE v."patient_id" = p."id";--> statement-breakpoint
ALTER TABLE "clinical_visit" ALTER COLUMN "birth_date_at_visit" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "clinical_visit" ALTER COLUMN "sex_at_visit" SET NOT NULL;