ALTER TABLE "family_report" ADD COLUMN "pdf_base64" text;--> statement-breakpoint
CREATE OR REPLACE FUNCTION prevent_approved_report_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.approved_at IS NOT NULL OR NEW.content IS DISTINCT FROM OLD.content OR (OLD.pdf_base64 IS NOT NULL AND NEW.pdf_base64 IS DISTINCT FROM OLD.pdf_base64) OR NEW.patient_id IS DISTINCT FROM OLD.patient_id OR NEW.version IS DISTINCT FROM OLD.version OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.id IS DISTINCT FROM OLD.id OR NEW.approved_at IS NULL OR NEW.approved_by IS NULL OR NEW.pdf_base64 IS NULL THEN
    RAISE EXCEPTION 'Report snapshots are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;