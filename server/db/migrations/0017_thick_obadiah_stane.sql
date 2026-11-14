CREATE TABLE "visit_sharing" (
	"visit_id" text PRIMARY KEY NOT NULL,
	"shared" boolean NOT NULL,
	"changed_by" text NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "visit_sharing" ADD CONSTRAINT "visit_sharing_visit_id_clinical_visit_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."clinical_visit"("id") ON DELETE restrict ON UPDATE no action;