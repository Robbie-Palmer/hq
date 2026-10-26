CREATE TYPE "public"."ingredient_group_relation_type" AS ENUM('classification', 'composition');--> statement-breakpoint
ALTER TABLE "ingredient_group_hierarchy" ADD COLUMN "relation_type" "ingredient_group_relation_type" DEFAULT 'classification' NOT NULL;--> statement-breakpoint
ALTER TABLE "ingredient_group_hierarchy" ALTER COLUMN "relation_type" DROP DEFAULT;--> statement-breakpoint
DELETE FROM "ingredient_group_member"
WHERE "group_key" = 'poultry'
	AND "ingredient_slug" IN (
		'chicken-breast',
		'chicken-thigh',
		'chicken-stock',
		'chicken-stock-pot'
	)
	AND EXISTS (
		SELECT 1
		FROM "ingredient_group_hierarchy"
		WHERE "narrower_group_key" = 'chicken'
			AND "broader_group_key" = 'poultry'
			AND "relation_type" = 'classification'
	);--> statement-breakpoint
CREATE OR REPLACE FUNCTION "reject_ingredient_group_hierarchy_cycle"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF NEW."relation_type" <> 'classification' THEN
		RETURN NEW;
	END IF;

	PERFORM pg_advisory_xact_lock(hashtext('ingredient_group_hierarchy'));
	IF EXISTS (
		WITH RECURSIVE "broader_groups" AS (
			SELECT NEW."broader_group_key" AS "group_key"
			UNION
			SELECT "hierarchy"."broader_group_key"
			FROM "ingredient_group_hierarchy" AS "hierarchy"
			INNER JOIN "broader_groups"
				ON "hierarchy"."narrower_group_key" = "broader_groups"."group_key"
			WHERE "hierarchy"."relation_type" = 'classification'
				AND NOT (
					TG_OP = 'UPDATE'
					AND "hierarchy"."narrower_group_key" = OLD."narrower_group_key"
					AND "hierarchy"."broader_group_key" = OLD."broader_group_key"
				)
		)
		SELECT 1
		FROM "broader_groups"
		WHERE "group_key" = NEW."narrower_group_key"
	) THEN
		RAISE EXCEPTION 'ingredient group classification cannot contain cycles'
			USING ERRCODE = '23514';
	END IF;
	RETURN NEW;
END;
$$;
