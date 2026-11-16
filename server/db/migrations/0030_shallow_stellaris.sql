CREATE TABLE "booking_notice" (
	"id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"status" text NOT NULL,
	"channel" text DEFAULT 'IN_APP' NOT NULL,
	"delivered" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "booking_proof" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"digest" text NOT NULL,
	"kind" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "booking_request" (
	"id" text PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"patient_id" text,
	"guardian_id" text,
	"child_name" text NOT NULL,
	"birth_date" text,
	"sex" text,
	"guardian_name" text NOT NULL,
	"relationship" text,
	"email" text NOT NULL,
	"phone" text,
	"starts_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"consent_version" text NOT NULL,
	"consent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"appointment_id" text,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_request_status_ck" CHECK ("booking_request"."status" IN ('PENDING','APPROVED','DECLINED')),
	CONSTRAINT "booking_request_source_ck" CHECK ("booking_request"."source" IN ('PUBLIC','PARENT'))
);
--> statement-breakpoint
ALTER TABLE "booking_notice" ADD CONSTRAINT "booking_notice_request_id_booking_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."booking_request"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_request" ADD CONSTRAINT "booking_request_patient_id_patient_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patient"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_request" ADD CONSTRAINT "booking_request_appointment_id_appointment_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointment"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "booking_notice_request_idx" ON "booking_notice" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "booking_proof_email_idx" ON "booking_proof" USING btree ("email","kind");--> statement-breakpoint
CREATE INDEX "booking_request_pending_idx" ON "booking_request" USING btree ("status","starts_at");--> statement-breakpoint
CREATE INDEX "booking_request_guardian_idx" ON "booking_request" USING btree ("guardian_id");--> statement-breakpoint
CREATE UNIQUE INDEX "booking_request_appointment_idx" ON "booking_request" USING btree ("appointment_id");