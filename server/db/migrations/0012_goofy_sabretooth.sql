CREATE TABLE "patient" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"birth_date" text NOT NULL,
	"sex" text NOT NULL,
	"gestation_days" integer,
	"correction_until_months" integer DEFAULT 24 NOT NULL,
	"birth_weight_kg" numeric,
	"birth_length_cm" numeric,
	"birth_head_circumference_cm" numeric,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "patient_sex_ck" CHECK ("patient"."sex" IN ('MALE', 'FEMALE')),
	CONSTRAINT "patient_correction_ck" CHECK ("patient"."correction_until_months" IN (24, 36))
);
--> statement-breakpoint
CREATE TABLE "clinical_visit" (
	"id" text PRIMARY KEY NOT NULL,
	"patient_id" text NOT NULL,
	"request_id" text NOT NULL,
	"request_digest" text NOT NULL,
	"measured_at" timestamp with time zone NOT NULL,
	"weight_kg" numeric NOT NULL,
	"length_height_cm" numeric NOT NULL,
	"position" text NOT NULL,
	"head_circumference_cm" numeric NOT NULL,
	"bmi" numeric NOT NULL,
	"gestation_days_at_birth" integer,
	"correction_until_months" integer NOT NULL,
	"author_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clinical_visit_request_id_unique" UNIQUE("request_id"),
	CONSTRAINT "clinical_visit_values_ck" CHECK ("clinical_visit"."weight_kg" > 0 AND "clinical_visit"."length_height_cm" > 0 AND "clinical_visit"."head_circumference_cm" > 0 AND "clinical_visit"."bmi" > 0),
	CONSTRAINT "clinical_visit_position_ck" CHECK ("clinical_visit"."position" IN ('RECUMBENT', 'STANDING'))
);
--> statement-breakpoint
CREATE TABLE "visit_result" (
	"id" text PRIMARY KEY NOT NULL,
	"visit_id" text NOT NULL,
	"indicator" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "visit_text" (
	"visit_id" text PRIMARY KEY NOT NULL,
	"private_note" text,
	"parent_advice" text,
	"clinician_trend" text
);
--> statement-breakpoint
ALTER TABLE "clinical_visit" ADD CONSTRAINT "clinical_visit_patient_id_patient_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patient"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_result" ADD CONSTRAINT "visit_result_visit_id_clinical_visit_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."clinical_visit"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_text" ADD CONSTRAINT "visit_text_visit_id_clinical_visit_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."clinical_visit"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "clinical_visit_patient_idx" ON "clinical_visit" USING btree ("patient_id","measured_at");--> statement-breakpoint
CREATE INDEX "visit_result_visit_idx" ON "visit_result" USING btree ("visit_id");--> statement-breakpoint
CREATE FUNCTION prevent_clinical_snapshot_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Clinical snapshots are immutable';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER clinical_visit_immutable BEFORE UPDATE OR DELETE ON clinical_visit FOR EACH ROW EXECUTE FUNCTION prevent_clinical_snapshot_mutation();--> statement-breakpoint
CREATE TRIGGER visit_result_immutable BEFORE UPDATE OR DELETE ON visit_result FOR EACH ROW EXECUTE FUNCTION prevent_clinical_snapshot_mutation();--> statement-breakpoint
CREATE TRIGGER visit_text_immutable BEFORE UPDATE OR DELETE ON visit_text FOR EACH ROW EXECUTE FUNCTION prevent_clinical_snapshot_mutation();