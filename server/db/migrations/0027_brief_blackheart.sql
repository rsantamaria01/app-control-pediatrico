CREATE TABLE "family_report" (
	"id" text PRIMARY KEY NOT NULL,
	"patient_id" text NOT NULL,
	"content" jsonb NOT NULL,
	"version" integer NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_by" text,
	"approved_at" timestamp with time zone,
	CONSTRAINT "family_report_approval_ck" CHECK (("family_report"."approved_by" IS NULL) = ("family_report"."approved_at" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "family_report" ADD CONSTRAINT "family_report_patient_id_patient_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patient"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "family_report_patient_idx" ON "family_report" USING btree ("patient_id","approved_at");--> statement-breakpoint
CREATE FUNCTION prevent_approved_report_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.approved_at IS NOT NULL OR NEW.content IS DISTINCT FROM OLD.content OR NEW.patient_id IS DISTINCT FROM OLD.patient_id OR NEW.version IS DISTINCT FROM OLD.version OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.id IS DISTINCT FROM OLD.id OR NEW.approved_at IS NULL OR NEW.approved_by IS NULL THEN
    RAISE EXCEPTION 'Report snapshots are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER family_report_immutable BEFORE UPDATE OR DELETE ON family_report FOR EACH ROW EXECUTE FUNCTION prevent_approved_report_mutation();