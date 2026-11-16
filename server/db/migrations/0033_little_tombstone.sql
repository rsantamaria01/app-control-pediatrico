CREATE TABLE "doctor_catalog_entry" (
	"id" text PRIMARY KEY NOT NULL,
	"author_id" text NOT NULL,
	"label" text NOT NULL,
	"domain" text NOT NULL,
	"min_age_months" numeric NOT NULL,
	"max_age_months" numeric NOT NULL,
	"source" text NOT NULL,
	"status" text DEFAULT 'DRAFT_PENDING_PEDIATRICIAN_REVIEW' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "doctor_catalog_draft_ck" CHECK ("doctor_catalog_entry"."status" = 'DRAFT_PENDING_PEDIATRICIAN_REVIEW'),
	CONSTRAINT "doctor_catalog_age_ck" CHECK ("doctor_catalog_entry"."min_age_months" >= 0 AND "doctor_catalog_entry"."max_age_months" >= "doctor_catalog_entry"."min_age_months")
);
--> statement-breakpoint
CREATE TRIGGER doctor_catalog_immutable BEFORE UPDATE OR DELETE ON doctor_catalog_entry FOR EACH ROW EXECUTE FUNCTION prevent_catalog_mutation();
