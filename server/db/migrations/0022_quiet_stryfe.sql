CREATE TABLE "patient_contact_intake" (
	"id" text PRIMARY KEY NOT NULL,
	"patient_id" text NOT NULL,
	"name" text NOT NULL,
	"relationship" text NOT NULL,
	"phone" text NOT NULL,
	"email" text,
	"proof" text NOT NULL,
	"invite" boolean NOT NULL,
	"status" text DEFAULT 'LINK_FAILED' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "patient_contact_intake_status_ck" CHECK ("patient_contact_intake"."status" IN ('LINK_FAILED', 'LINKED'))
);
--> statement-breakpoint
ALTER TABLE "patient_contact_intake" ADD CONSTRAINT "patient_contact_intake_patient_id_patient_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patient"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "patient_contact_intake_patient_idx" ON "patient_contact_intake" USING btree ("patient_id","status");