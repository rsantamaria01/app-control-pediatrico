CREATE TABLE "complementary_vaccine" (
	"id" text PRIMARY KEY NOT NULL,
	"patient_id" text NOT NULL,
	"author_id" text NOT NULL,
	"label" text NOT NULL,
	"dose_label" text NOT NULL,
	"source" text NOT NULL,
	"status" text DEFAULT 'DRAFT_PENDING_PEDIATRICIAN_REVIEW' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "complementary_vaccine_status_ck" CHECK ("complementary_vaccine"."status" = 'DRAFT_PENDING_PEDIATRICIAN_REVIEW')
);
--> statement-breakpoint
CREATE TABLE "completed_checkup" (
	"id" text PRIMARY KEY NOT NULL,
	"patient_id" text NOT NULL,
	"release_id" text,
	"key" text,
	"individual_id" text,
	"completed_at" text NOT NULL,
	"author_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "completed_checkup_target_ck" CHECK (("completed_checkup"."individual_id" IS NOT NULL) <> ("completed_checkup"."release_id" IS NOT NULL AND "completed_checkup"."key" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "individual_checkup" (
	"id" text PRIMARY KEY NOT NULL,
	"patient_id" text NOT NULL,
	"date" text NOT NULL,
	"reason" text NOT NULL,
	"author_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "milestone_assessment" (
	"id" text PRIMARY KEY NOT NULL,
	"patient_id" text NOT NULL,
	"label" text NOT NULL,
	"domain" text NOT NULL,
	"outcome" text NOT NULL,
	"acquired_age_months" numeric,
	"private_note" text,
	"author_id" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "milestone_assessment_outcome_ck" CHECK ("milestone_assessment"."outcome" IN ('ACHIEVED','NOT_ACHIEVED','NOT_ASSESSED'))
);
--> statement-breakpoint
CREATE TABLE "screening_application" (
	"id" text PRIMARY KEY NOT NULL,
	"patient_id" text NOT NULL,
	"category" text NOT NULL,
	"instrument" text NOT NULL,
	"applied_at" text NOT NULL,
	"result" text NOT NULL,
	"private_note" text,
	"author_id" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vaccine_dose" (
	"id" text PRIMARY KEY NOT NULL,
	"patient_id" text NOT NULL,
	"release_id" text,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"dose_label" text,
	"catalog_version" text NOT NULL,
	"source_page" text NOT NULL,
	"source_status" text NOT NULL,
	"applied_at" text NOT NULL,
	"external" boolean NOT NULL,
	"lot" text,
	"private_note" text,
	"author_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vaccine_dose_date_ck" CHECK ("vaccine_dose"."applied_at" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
);
--> statement-breakpoint
ALTER TABLE "completed_checkup" ADD CONSTRAINT "completed_checkup_release_id_catalog_release_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."catalog_release"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "completed_checkup" ADD CONSTRAINT "completed_checkup_individual_id_individual_checkup_id_fk" FOREIGN KEY ("individual_id") REFERENCES "public"."individual_checkup"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vaccine_dose" ADD CONSTRAINT "vaccine_dose_release_id_catalog_release_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."catalog_release"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "complementary_vaccine_patient_idx" ON "complementary_vaccine" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "completed_checkup_patient_idx" ON "completed_checkup" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "individual_checkup_patient_idx" ON "individual_checkup" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "milestone_assessment_patient_idx" ON "milestone_assessment" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "screening_application_patient_idx" ON "screening_application" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "vaccine_dose_patient_idx" ON "vaccine_dose" USING btree ("patient_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vaccine_dose_unique_idx" ON "vaccine_dose" USING btree ("patient_id","release_id","key");