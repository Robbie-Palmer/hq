DO $$
DECLARE
	existing_kind text;
	existing_values text[];
BEGIN
	-- Reconcile an unjournaled enum left by an interrupted deployment, but
	-- reject any existing type that does not match the application contract.
	SELECT
		t.typtype::text,
		array_agg(e.enumlabel::text ORDER BY e.enumsortorder)
			FILTER (WHERE e.enumlabel IS NOT NULL)
	INTO existing_kind, existing_values
	FROM pg_type t
	JOIN pg_namespace n ON n.oid = t.typnamespace
	LEFT JOIN pg_enum e ON e.enumtypid = t.oid
	WHERE n.nspname = 'public'
		AND t.typname = 'leftover_storage_location'
	GROUP BY t.typtype;

	IF existing_kind IS NULL THEN
		CREATE TYPE "public"."leftover_storage_location" AS ENUM('fridge', 'freezer');
	ELSIF existing_kind <> 'e'
		OR existing_values IS DISTINCT FROM ARRAY['fridge', 'freezer']::text[] THEN
		RAISE EXCEPTION 'Existing type public.leftover_storage_location is incompatible';
	END IF;
END
$$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "leftover_batch" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cooking_session_id" uuid NOT NULL,
	"user_id" text,
	"organization_id" text,
	"recipe_slug" text NOT NULL,
	"recipe_title" text NOT NULL,
	"recipe_version" text NOT NULL,
	"portions_remaining" integer NOT NULL,
	"storage" "leftover_storage_location" NOT NULL,
	"use_by" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leftover_batch_cookingSessionId_unique" UNIQUE("cooking_session_id"),
	CONSTRAINT "leftover_batch_owner_check" CHECK (num_nonnulls("leftover_batch"."user_id", "leftover_batch"."organization_id") = 1),
	CONSTRAINT "leftover_batch_portions_check" CHECK ("leftover_batch"."portions_remaining" > 0)
);
--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint
		WHERE conrelid = 'public.leftover_batch'::regclass
			AND contype = 'p'
	) THEN
		ALTER TABLE "leftover_batch" ADD CONSTRAINT "leftover_batch_pkey" PRIMARY KEY ("id");
	END IF;
END
$$;--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint
		WHERE conrelid = 'public.leftover_batch'::regclass
			AND conname = 'leftover_batch_cookingSessionId_unique'
	) THEN
		ALTER TABLE "leftover_batch" ADD CONSTRAINT "leftover_batch_cookingSessionId_unique" UNIQUE("cooking_session_id");
	END IF;
END
$$;--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint
		WHERE conrelid = 'public.leftover_batch'::regclass
			AND conname = 'leftover_batch_owner_check'
	) THEN
		ALTER TABLE "leftover_batch" ADD CONSTRAINT "leftover_batch_owner_check" CHECK (num_nonnulls("leftover_batch"."user_id", "leftover_batch"."organization_id") = 1);
	END IF;
END
$$;--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint
		WHERE conrelid = 'public.leftover_batch'::regclass
			AND conname = 'leftover_batch_portions_check'
	) THEN
		ALTER TABLE "leftover_batch" ADD CONSTRAINT "leftover_batch_portions_check" CHECK ("leftover_batch"."portions_remaining" > 0);
	END IF;
END
$$;--> statement-breakpoint
ALTER TABLE "cooking_session" ADD COLUMN IF NOT EXISTS "recipe_version" text;--> statement-breakpoint
ALTER TABLE "cooking_session" ADD COLUMN IF NOT EXISTS "repeat_of_session_id" uuid;--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint
		WHERE conrelid = 'public.leftover_batch'::regclass
			AND conname = 'leftover_batch_cooking_session_id_cooking_session_id_fk'
	) THEN
		ALTER TABLE "leftover_batch" ADD CONSTRAINT "leftover_batch_cooking_session_id_cooking_session_id_fk" FOREIGN KEY ("cooking_session_id") REFERENCES "public"."cooking_session"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END
$$;--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint
		WHERE conrelid = 'public.leftover_batch'::regclass
			AND conname = 'leftover_batch_user_id_user_id_fk'
	) THEN
		ALTER TABLE "leftover_batch" ADD CONSTRAINT "leftover_batch_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END
$$;--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint
		WHERE conrelid = 'public.leftover_batch'::regclass
			AND conname = 'leftover_batch_organization_id_organization_id_fk'
	) THEN
		ALTER TABLE "leftover_batch" ADD CONSTRAINT "leftover_batch_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END
$$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leftover_batch_user_use_by_idx" ON "leftover_batch" USING btree ("user_id","use_by");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leftover_batch_household_use_by_idx" ON "leftover_batch" USING btree ("organization_id","use_by");--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint
		WHERE conrelid = 'public.cooking_session'::regclass
			AND conname = 'cooking_session_repeat_of_session_id_cooking_session_id_fk'
	) THEN
		ALTER TABLE "cooking_session" ADD CONSTRAINT "cooking_session_repeat_of_session_id_cooking_session_id_fk" FOREIGN KEY ("repeat_of_session_id") REFERENCES "public"."cooking_session"("id") ON DELETE set null ON UPDATE no action;
	END IF;
END
$$;--> statement-breakpoint
ALTER TABLE "cooking_session" DROP COLUMN IF EXISTS "diners";
