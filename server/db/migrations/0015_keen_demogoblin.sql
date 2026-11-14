CREATE TABLE "guardian_grant" (
	"patient_id" text NOT NULL,
	"guardian_id" text NOT NULL,
	"contact_email" text NOT NULL,
	"proof" text NOT NULL,
	"verified_by" text NOT NULL,
	"verified_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text NOT NULL,
	"token_id" text,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "guardian_grant_patient_id_guardian_id_pk" PRIMARY KEY("patient_id","guardian_id"),
	CONSTRAINT "guardian_grant_status_ck" CHECK ("guardian_grant"."status" IN ('PENDING', 'ACTIVE', 'FAILED', 'REVOKED'))
);
--> statement-breakpoint
ALTER TABLE "guardian_grant" ADD CONSTRAINT "guardian_grant_patient_id_patient_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patient"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guardian_grant" ADD CONSTRAINT "guardian_grant_guardian_id_user_id_fk" FOREIGN KEY ("guardian_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guardian_grant" ADD CONSTRAINT "guardian_grant_token_id_setup_token_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."setup_token"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "guardian_grant_guardian_idx" ON "guardian_grant" USING btree ("guardian_id","status");