CREATE EXTENSION IF NOT EXISTS unaccent;--> statement-breakpoint
ALTER TABLE "patient" ADD COLUMN "given_names" text;--> statement-breakpoint
ALTER TABLE "patient" ADD COLUMN "surnames" text;--> statement-breakpoint
ALTER TABLE "patient" ADD COLUMN "national_id" text;--> statement-breakpoint
ALTER TABLE "patient" ADD COLUMN "hsm_record" text;--> statement-breakpoint
ALTER TABLE "patient" ADD COLUMN "perinatal_notes" text;--> statement-breakpoint
CREATE UNIQUE INDEX "patient_national_id_idx" ON "patient" USING btree ("national_id");--> statement-breakpoint
ALTER TABLE "patient" ADD CONSTRAINT "patient_national_id_ck" CHECK ("patient"."national_id" IS NULL OR "patient"."national_id" ~ '^[0-9]{10}$');