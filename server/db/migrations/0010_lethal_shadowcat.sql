CREATE TABLE "who_dataset" (
	"id" text PRIMARY KEY NOT NULL,
	"publisher" text NOT NULL,
	"standard" text NOT NULL,
	"version" text NOT NULL,
	"publication_date" text NOT NULL,
	"retrieved_at" text NOT NULL,
	"source_url" text NOT NULL,
	"sha256" text NOT NULL,
	"indicator" text NOT NULL,
	"sex" text NOT NULL,
	"position" text,
	"x_unit" text NOT NULL,
	"min_x" numeric NOT NULL,
	"max_x" numeric NOT NULL,
	"row_count" integer NOT NULL,
	"imported_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "who_dataset_standard_ck" CHECK ("who_dataset"."publisher" = 'WHO' AND "who_dataset"."standard" = 'WHO_2006'),
	CONSTRAINT "who_dataset_sex_ck" CHECK ("who_dataset"."sex" IN ('MALE', 'FEMALE')),
	CONSTRAINT "who_dataset_indicator_ck" CHECK ("who_dataset"."indicator" IN ('WEIGHT_FOR_AGE', 'HEIGHT_FOR_AGE', 'WEIGHT_FOR_LENGTH', 'WEIGHT_FOR_HEIGHT', 'BMI_FOR_AGE', 'HEAD_CIRCUMFERENCE_FOR_AGE')),
	CONSTRAINT "who_dataset_unit_ck" CHECK ("who_dataset"."x_unit" IN ('DAY', 'CM')),
	CONSTRAINT "who_dataset_position_ck" CHECK ("who_dataset"."position" IS NULL OR "who_dataset"."position" IN ('RECUMBENT', 'STANDING')),
	CONSTRAINT "who_dataset_count_ck" CHECK ("who_dataset"."row_count" > 0 AND "who_dataset"."min_x" >= 0 AND "who_dataset"."max_x" > "who_dataset"."min_x"),
	CONSTRAINT "who_dataset_hash_ck" CHECK ("who_dataset"."sha256" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "who_reference_row" (
	"dataset_id" text NOT NULL,
	"indicator" text NOT NULL,
	"sex" text NOT NULL,
	"position" text,
	"x_unit" text NOT NULL,
	"x" numeric NOT NULL,
	"l" numeric NOT NULL,
	"m" numeric NOT NULL,
	"s" numeric NOT NULL,
	"sd_neg3" numeric NOT NULL,
	"sd_neg2" numeric NOT NULL,
	"sd_neg1" numeric NOT NULL,
	"sd_0" numeric NOT NULL,
	"sd_1" numeric NOT NULL,
	"sd_2" numeric NOT NULL,
	"sd_3" numeric NOT NULL,
	CONSTRAINT "who_reference_row_dataset_id_x_pk" PRIMARY KEY("dataset_id","x"),
	CONSTRAINT "who_row_lms_ck" CHECK ("who_reference_row"."m" > 0 AND "who_reference_row"."s" > 0 AND "who_reference_row"."x" >= 0),
	CONSTRAINT "who_row_sd_ck" CHECK ("who_reference_row"."sd_neg3" > 0 AND "who_reference_row"."sd_neg3" < "who_reference_row"."sd_neg2" AND "who_reference_row"."sd_neg2" < "who_reference_row"."sd_neg1" AND "who_reference_row"."sd_neg1" < "who_reference_row"."sd_0" AND "who_reference_row"."sd_0" < "who_reference_row"."sd_1" AND "who_reference_row"."sd_1" < "who_reference_row"."sd_2" AND "who_reference_row"."sd_2" < "who_reference_row"."sd_3"),
	CONSTRAINT "who_row_sex_ck" CHECK ("who_reference_row"."sex" IN ('MALE', 'FEMALE')),
	CONSTRAINT "who_row_unit_ck" CHECK ("who_reference_row"."x_unit" IN ('DAY', 'CM')),
	CONSTRAINT "who_row_position_ck" CHECK ("who_reference_row"."position" IS NULL OR "who_reference_row"."position" IN ('RECUMBENT', 'STANDING'))
);
--> statement-breakpoint
ALTER TABLE "who_reference_row" ADD CONSTRAINT "who_reference_row_dataset_id_who_dataset_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "public"."who_dataset"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "who_dataset_release_idx" ON "who_dataset" USING btree ("version","indicator","sex","source_url");
--> statement-breakpoint
CREATE FUNCTION who_reference_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'WHO reference datasets and rows are immutable'; END $$;
--> statement-breakpoint
CREATE TRIGGER who_dataset_immutable BEFORE UPDATE OR DELETE ON who_dataset FOR EACH ROW EXECUTE FUNCTION who_reference_immutable();
--> statement-breakpoint
CREATE TRIGGER who_row_immutable BEFORE UPDATE OR DELETE ON who_reference_row FOR EACH ROW EXECUTE FUNCTION who_reference_immutable();
--> statement-breakpoint
CREATE FUNCTION who_row_matches_dataset() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE d who_dataset%ROWTYPE; BEGIN SELECT * INTO d FROM who_dataset WHERE id = NEW.dataset_id; IF NEW.indicator <> d.indicator OR NEW.sex <> d.sex OR NEW.x_unit <> d.x_unit OR NEW.x < d.min_x OR NEW.x > d.max_x OR (d.indicator = 'HEIGHT_FOR_AGE' AND NEW.position IS DISTINCT FROM (CASE WHEN NEW.x <= 730 THEN 'RECUMBENT' ELSE 'STANDING' END)) OR (d.indicator <> 'HEIGHT_FOR_AGE' AND NEW.position IS DISTINCT FROM d.position) OR (NEW.x_unit = 'DAY' AND NEW.x <> trunc(NEW.x)) OR (NEW.x_unit = 'CM' AND NEW.x * 10 <> trunc(NEW.x * 10)) THEN RAISE EXCEPTION 'WHO row does not match dataset'; END IF; RETURN NEW; END $$;
--> statement-breakpoint
CREATE TRIGGER who_row_dataset_guard BEFORE INSERT ON who_reference_row FOR EACH ROW EXECUTE FUNCTION who_row_matches_dataset();