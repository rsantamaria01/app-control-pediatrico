CREATE TABLE "catalog_item" (
	"release_id" text NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"domain" text NOT NULL,
	"min_age_months" numeric NOT NULL,
	"max_age_months" numeric NOT NULL,
	"source_page" text NOT NULL,
	"status" text DEFAULT 'DRAFT_PENDING_PEDIATRICIAN_REVIEW' NOT NULL,
	CONSTRAINT "catalog_item_release_id_key_pk" PRIMARY KEY("release_id","key"),
	CONSTRAINT "catalog_item_draft_ck" CHECK ("catalog_item"."status" = 'DRAFT_PENDING_PEDIATRICIAN_REVIEW'),
	CONSTRAINT "catalog_item_source_ck" CHECK (length(btrim("catalog_item"."key")) > 0 AND length(btrim("catalog_item"."label")) > 0 AND length(btrim("catalog_item"."domain")) > 0 AND length(btrim("catalog_item"."source_page")) > 0),
	CONSTRAINT "catalog_item_age_ck" CHECK ("catalog_item"."min_age_months" >= 0 AND "catalog_item"."max_age_months" >= "catalog_item"."min_age_months")
);
--> statement-breakpoint
CREATE TABLE "catalog_release" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"publisher" text NOT NULL,
	"title" text NOT NULL,
	"version" text NOT NULL,
	"publication_date" text NOT NULL,
	"retrieved_at" text NOT NULL,
	"url" text NOT NULL,
	"sha256" text NOT NULL,
	"status" text DEFAULT 'DRAFT_PENDING_PEDIATRICIAN_REVIEW' NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_release_kind_ck" CHECK ("catalog_release"."kind" IN ('MOTOR','MILESTONE','SCREENING','CHECKUP','VACCINE')),
	CONSTRAINT "catalog_release_draft_ck" CHECK ("catalog_release"."status" = 'DRAFT_PENDING_PEDIATRICIAN_REVIEW'),
	CONSTRAINT "catalog_release_source_ck" CHECK (length(btrim("catalog_release"."publisher")) > 0 AND length(btrim("catalog_release"."title")) > 0 AND length(btrim("catalog_release"."version")) > 0 AND "catalog_release"."url" LIKE 'https://%' AND "catalog_release"."sha256" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "catalog_release_date_ck" CHECK ("catalog_release"."publication_date" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' AND "catalog_release"."retrieved_at" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
);
--> statement-breakpoint
ALTER TABLE "catalog_item" ADD CONSTRAINT "catalog_item_release_id_catalog_release_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."catalog_release"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_release_identity_idx" ON "catalog_release" USING btree ("kind","publisher","version","url");--> statement-breakpoint
CREATE INDEX "catalog_release_kind_idx" ON "catalog_release" USING btree ("kind","imported_at");
--> statement-breakpoint
CREATE FUNCTION prevent_catalog_mutation() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'catalog revisions are immutable'; END; $$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER catalog_release_immutable BEFORE UPDATE OR DELETE ON catalog_release FOR EACH ROW EXECUTE FUNCTION prevent_catalog_mutation();
--> statement-breakpoint
CREATE TRIGGER catalog_item_immutable BEFORE UPDATE OR DELETE ON catalog_item FOR EACH ROW EXECUTE FUNCTION prevent_catalog_mutation();
