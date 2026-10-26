DO $$
DECLARE
	existing_values text[];
BEGIN
	SELECT array_agg(e.enumlabel::text ORDER BY e.enumsortorder)
	INTO existing_values
	FROM pg_type t
	JOIN pg_namespace n ON n.oid = t.typnamespace
	LEFT JOIN pg_enum e ON e.enumtypid = t.oid
	WHERE n.nspname = 'public'
		AND t.typname = 'ingredient_property_catalog_status';
	IF existing_values IS NULL THEN
		CREATE TYPE "public"."ingredient_property_catalog_status" AS ENUM('draft', 'published');
	ELSIF existing_values IS DISTINCT FROM ARRAY['draft', 'published']::text[] THEN
		RAISE EXCEPTION 'Existing type public.ingredient_property_catalog_status is incompatible';
	END IF;
END
$$;--> statement-breakpoint
DO $$
DECLARE
	existing_values text[];
BEGIN
	SELECT array_agg(e.enumlabel::text ORDER BY e.enumsortorder)
	INTO existing_values
	FROM pg_type t
	JOIN pg_namespace n ON n.oid = t.typnamespace
	LEFT JOIN pg_enum e ON e.enumtypid = t.oid
	WHERE n.nspname = 'public'
		AND t.typname = 'ingredient_property_kind';
	IF existing_values IS NULL THEN
		CREATE TYPE "public"."ingredient_property_kind" AS ENUM('density', 'edible_mass_fraction', 'nutrient');
	ELSIF existing_values IS DISTINCT FROM ARRAY['density', 'edible_mass_fraction', 'nutrient']::text[] THEN
		RAISE EXCEPTION 'Existing type public.ingredient_property_kind is incompatible';
	END IF;
END
$$;--> statement-breakpoint
DO $$
DECLARE
	existing_values text[];
BEGIN
	SELECT array_agg(e.enumlabel::text ORDER BY e.enumsortorder)
	INTO existing_values
	FROM pg_type t
	JOIN pg_namespace n ON n.oid = t.typnamespace
	LEFT JOIN pg_enum e ON e.enumtypid = t.oid
	WHERE n.nspname = 'public'
		AND t.typname = 'ingredient_property_release_status';
	IF existing_values IS NULL THEN
		CREATE TYPE "public"."ingredient_property_release_status" AS ENUM('staged', 'validated', 'rejected');
	ELSIF existing_values IS DISTINCT FROM ARRAY['staged', 'validated', 'rejected']::text[] THEN
		RAISE EXCEPTION 'Existing type public.ingredient_property_release_status is incompatible';
	END IF;
END
$$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ingredient_property_catalog_source_release" (
	"catalog_version" text NOT NULL,
	"source_release_id" uuid NOT NULL,
	CONSTRAINT "ingredient_property_catalog_source_release_pk" PRIMARY KEY("catalog_version","source_release_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ingredient_property_catalog_version" (
	"version" text PRIMARY KEY NOT NULL,
	"status" "ingredient_property_catalog_status" DEFAULT 'draft' NOT NULL,
	"effective_at" timestamp with time zone NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ingredient_property_catalog_version_name_check" CHECK (length("ingredient_property_catalog_version"."version") > 0),
	CONSTRAINT "ingredient_property_catalog_version_publish_check" CHECK (("ingredient_property_catalog_version"."status" = 'published') = ("ingredient_property_catalog_version"."published_at" is not null))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ingredient_property_observation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_release_id" uuid NOT NULL,
	"source_record_id" text NOT NULL,
	"ingredient_slug" text NOT NULL,
	"preparation_state" text NOT NULL,
	"property_kind" "ingredient_property_kind" NOT NULL,
	"property_key" text NOT NULL,
	"value" jsonb NOT NULL,
	"confidence" numeric(5, 4) NOT NULL,
	"original_record" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ingredient_property_observation_identity_check" CHECK (length("ingredient_property_observation"."source_record_id") > 0 and length("ingredient_property_observation"."preparation_state") > 0 and length("ingredient_property_observation"."property_key") > 0),
	CONSTRAINT "ingredient_property_observation_confidence_check" CHECK ("ingredient_property_observation"."confidence" >= 0 and "ingredient_property_observation"."confidence" <= 1)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ingredient_property_selection" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"catalog_version" text NOT NULL,
	"ingredient_slug" text NOT NULL,
	"preparation_state" text NOT NULL,
	"property_key" text NOT NULL,
	"observation_id" uuid NOT NULL,
	"confidence" numeric(5, 4) NOT NULL,
	"reconciliation_decision" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ingredient_property_selection_identity_check" CHECK (length("ingredient_property_selection"."preparation_state") > 0 and length("ingredient_property_selection"."property_key") > 0),
	CONSTRAINT "ingredient_property_selection_confidence_check" CHECK ("ingredient_property_selection"."confidence" >= 0 and "ingredient_property_selection"."confidence" <= 1)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ingredient_property_source" (
	"id" text PRIMARY KEY NOT NULL,
	"publisher" text NOT NULL,
	"dataset" text NOT NULL,
	"canonical_url" text NOT NULL,
	"license" text NOT NULL,
	"license_url" text,
	"attribution" text NOT NULL,
	"redistribution_allowed" boolean NOT NULL,
	"derivative_use_allowed" boolean NOT NULL,
	"admitted_at" timestamp with time zone NOT NULL,
	"admission_notes" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ingredient_property_source_identity_check" CHECK (length("ingredient_property_source"."publisher") > 0 and length("ingredient_property_source"."dataset") > 0),
	CONSTRAINT "ingredient_property_source_license_check" CHECK (length("ingredient_property_source"."license") > 0 and length("ingredient_property_source"."attribution") > 0),
	CONSTRAINT "ingredient_property_source_admission_check" CHECK (length("ingredient_property_source"."admission_notes") > 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ingredient_property_source_release" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" text NOT NULL,
	"effective_version" text NOT NULL,
	"effective_at" timestamp with time zone NOT NULL,
	"retrieved_at" timestamp with time zone NOT NULL,
	"checksum_sha256" text NOT NULL,
	"connector_version" text NOT NULL,
	"status" "ingredient_property_release_status" DEFAULT 'staged' NOT NULL,
	"diagnostics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ingredient_property_source_release_version_check" CHECK (length("ingredient_property_source_release"."effective_version") > 0 and length("ingredient_property_source_release"."connector_version") > 0),
	CONSTRAINT "ingredient_property_source_release_checksum_check" CHECK ("ingredient_property_source_release"."checksum_sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'property_catalog_source_version_fk') THEN
		ALTER TABLE "ingredient_property_catalog_source_release" ADD CONSTRAINT "property_catalog_source_version_fk" FOREIGN KEY ("catalog_version") REFERENCES "public"."ingredient_property_catalog_version"("version") ON DELETE restrict ON UPDATE no action;
	END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'property_catalog_source_release_fk') THEN
		ALTER TABLE "ingredient_property_catalog_source_release" ADD CONSTRAINT "property_catalog_source_release_fk" FOREIGN KEY ("source_release_id") REFERENCES "public"."ingredient_property_source_release"("id") ON DELETE restrict ON UPDATE no action;
	END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'property_observation_release_fk') THEN
		ALTER TABLE "ingredient_property_observation" ADD CONSTRAINT "property_observation_release_fk" FOREIGN KEY ("source_release_id") REFERENCES "public"."ingredient_property_source_release"("id") ON DELETE restrict ON UPDATE no action;
	END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'property_observation_ingredient_fk') THEN
		ALTER TABLE "ingredient_property_observation" ADD CONSTRAINT "property_observation_ingredient_fk" FOREIGN KEY ("ingredient_slug") REFERENCES "public"."ingredient"("slug") ON DELETE restrict ON UPDATE no action;
	END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'property_selection_catalog_fk') THEN
		ALTER TABLE "ingredient_property_selection" ADD CONSTRAINT "property_selection_catalog_fk" FOREIGN KEY ("catalog_version") REFERENCES "public"."ingredient_property_catalog_version"("version") ON DELETE restrict ON UPDATE no action;
	END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'property_selection_ingredient_fk') THEN
		ALTER TABLE "ingredient_property_selection" ADD CONSTRAINT "property_selection_ingredient_fk" FOREIGN KEY ("ingredient_slug") REFERENCES "public"."ingredient"("slug") ON DELETE restrict ON UPDATE no action;
	END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'property_selection_observation_fk') THEN
		ALTER TABLE "ingredient_property_selection" ADD CONSTRAINT "property_selection_observation_fk" FOREIGN KEY ("observation_id") REFERENCES "public"."ingredient_property_observation"("id") ON DELETE restrict ON UPDATE no action;
	END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'property_release_source_fk') THEN
		ALTER TABLE "ingredient_property_source_release" ADD CONSTRAINT "property_release_source_fk" FOREIGN KEY ("source_id") REFERENCES "public"."ingredient_property_source"("id") ON DELETE restrict ON UPDATE no action;
	END IF;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ingredient_property_catalog_version_effective_idx" ON "ingredient_property_catalog_version" USING btree ("status","effective_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ingredient_property_observation_source_record_uidx" ON "ingredient_property_observation" USING btree ("source_release_id","source_record_id","ingredient_slug","preparation_state","property_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ingredient_property_observation_lookup_idx" ON "ingredient_property_observation" USING btree ("ingredient_slug","preparation_state","property_key");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ingredient_property_selection_catalog_property_uidx" ON "ingredient_property_selection" USING btree ("catalog_version","ingredient_slug","preparation_state","property_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ingredient_property_selection_observation_idx" ON "ingredient_property_selection" USING btree ("observation_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ingredient_property_source_release_version_uidx" ON "ingredient_property_source_release" USING btree ("source_id","effective_version");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ingredient_property_source_release_checksum_uidx" ON "ingredient_property_source_release" USING btree ("source_id","checksum_sha256");
