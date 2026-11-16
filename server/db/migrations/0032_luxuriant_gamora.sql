ALTER TABLE "catalog_release" DROP CONSTRAINT "catalog_release_date_ck";--> statement-breakpoint
ALTER TABLE "catalog_release" ALTER COLUMN "publication_date" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "catalog_item" ADD COLUMN "source_pages" jsonb;--> statement-breakpoint
ALTER TABLE "catalog_item" ADD COLUMN "dose_number" numeric;--> statement-breakpoint
ALTER TABLE "catalog_item" ADD COLUMN "recommended_age" text;--> statement-breakpoint
ALTER TABLE "catalog_item" ADD COLUMN "minimum_interval" text;--> statement-breakpoint
ALTER TABLE "catalog_item" ADD COLUMN "provenance" text;--> statement-breakpoint
ALTER TABLE "catalog_release" ADD COLUMN "sources" jsonb;--> statement-breakpoint
ALTER TABLE "catalog_item" ADD CONSTRAINT "catalog_item_dose_ck" CHECK ("catalog_item"."dose_number" IS NULL OR "catalog_item"."dose_number" >= 1);--> statement-breakpoint
ALTER TABLE "catalog_release" ADD CONSTRAINT "catalog_release_date_ck" CHECK (("catalog_release"."publication_date" IS NULL OR "catalog_release"."publication_date" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$') AND "catalog_release"."retrieved_at" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$');