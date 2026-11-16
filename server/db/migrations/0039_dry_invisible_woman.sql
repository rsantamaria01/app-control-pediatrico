CREATE TABLE "vaccine_dose_claim" (
	"patient_id" text NOT NULL,
	"publisher" text NOT NULL,
	"version" text NOT NULL,
	"url" text NOT NULL,
	"key" text NOT NULL,
	"dose_id" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vaccine_dose_claim" ADD CONSTRAINT "vaccine_dose_claim_dose_id_vaccine_dose_id_fk" FOREIGN KEY ("dose_id") REFERENCES "public"."vaccine_dose"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
INSERT INTO "vaccine_dose_claim" ("patient_id", "publisher", "version", "url", "key", "dose_id") SELECT DISTINCT ON (d.patient_id, r.publisher, r.version, r.url, d.key) d.patient_id, r.publisher, r.version, r.url, d.key, d.id FROM vaccine_dose d JOIN catalog_release r ON r.id = d.release_id ORDER BY d.patient_id, r.publisher, r.version, r.url, d.key, d.created_at, d.id;--> statement-breakpoint
CREATE UNIQUE INDEX "vaccine_dose_claim_identity_idx" ON "vaccine_dose_claim" USING btree ("patient_id","publisher","version","url","key");--> statement-breakpoint
CREATE UNIQUE INDEX "vaccine_dose_claim_dose_idx" ON "vaccine_dose_claim" USING btree ("dose_id");