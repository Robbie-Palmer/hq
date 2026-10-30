CREATE TABLE IF NOT EXISTS "recipe_import_photo_group" (
	"id" uuid PRIMARY KEY NOT NULL,
	"manifest_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"title" text,
	"checksum" text NOT NULL,
	CONSTRAINT "recipe_import_photo_group_position_nonnegative" CHECK ("recipe_import_photo_group"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "recipe_import_photo_group_image" (
	"manifest_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"image_id" uuid NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "recipe_import_photo_group_image_manifest_id_image_id_pk" PRIMARY KEY("manifest_id","image_id"),
	CONSTRAINT "recipe_import_photo_group_image_position_nonnegative" CHECK ("recipe_import_photo_group_image"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "recipe_import_photo_image" (
	"id" uuid PRIMARY KEY NOT NULL,
	"batch_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"filename" text NOT NULL,
	"content_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"r2_key" text NOT NULL,
	"checksum" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recipe_import_photo_image_position_nonnegative" CHECK ("recipe_import_photo_image"."position" >= 0),
	CONSTRAINT "recipe_import_photo_image_byte_size_positive" CHECK ("recipe_import_photo_image"."byte_size" > 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "recipe_import_photo_manifest" (
	"id" uuid PRIMARY KEY NOT NULL,
	"batch_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"request_fingerprint" text NOT NULL,
	"checksum" text NOT NULL,
	"confirmed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recipe_import_photo_manifest_version_positive" CHECK ("recipe_import_photo_manifest"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "recipe_import_batch" ADD COLUMN IF NOT EXISTS "kind" text DEFAULT 'structured' NOT NULL;--> statement-breakpoint
ALTER TABLE "recipe_import_job" ADD COLUMN IF NOT EXISTS "photo_group_checksum" text;--> statement-breakpoint
ALTER TABLE "recipe_import_job" ADD COLUMN IF NOT EXISTS "photo_manifest_version" integer;--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'recipe_photo_group_manifest_fk') THEN
		ALTER TABLE "recipe_import_photo_group" ADD CONSTRAINT "recipe_photo_group_manifest_fk" FOREIGN KEY ("manifest_id") REFERENCES "public"."recipe_import_photo_manifest"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END
$$;--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'recipe_photo_group_job_fk') THEN
		ALTER TABLE "recipe_import_photo_group" ADD CONSTRAINT "recipe_photo_group_job_fk" FOREIGN KEY ("job_id") REFERENCES "public"."recipe_import_job"("id") ON DELETE restrict ON UPDATE no action;
	END IF;
END
$$;--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'recipe_photo_member_manifest_fk') THEN
		ALTER TABLE "recipe_import_photo_group_image" ADD CONSTRAINT "recipe_photo_member_manifest_fk" FOREIGN KEY ("manifest_id") REFERENCES "public"."recipe_import_photo_manifest"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END
$$;--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'recipe_photo_member_group_fk') THEN
		ALTER TABLE "recipe_import_photo_group_image" ADD CONSTRAINT "recipe_photo_member_group_fk" FOREIGN KEY ("group_id") REFERENCES "public"."recipe_import_photo_group"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END
$$;--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'recipe_photo_member_image_fk') THEN
		ALTER TABLE "recipe_import_photo_group_image" ADD CONSTRAINT "recipe_photo_member_image_fk" FOREIGN KEY ("image_id") REFERENCES "public"."recipe_import_photo_image"("id") ON DELETE restrict ON UPDATE no action;
	END IF;
END
$$;--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'recipe_photo_image_batch_fk') THEN
		ALTER TABLE "recipe_import_photo_image" ADD CONSTRAINT "recipe_photo_image_batch_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."recipe_import_batch"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END
$$;--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'recipe_photo_manifest_batch_fk') THEN
		ALTER TABLE "recipe_import_photo_manifest" ADD CONSTRAINT "recipe_photo_manifest_batch_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."recipe_import_batch"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END
$$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "recipe_import_photo_group_manifest_position_unique" ON "recipe_import_photo_group" USING btree ("manifest_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "recipe_import_photo_group_manifest_job_unique" ON "recipe_import_photo_group" USING btree ("manifest_id","job_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "recipe_import_photo_group_image_position_unique" ON "recipe_import_photo_group_image" USING btree ("group_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "recipe_import_photo_image_batch_position_unique" ON "recipe_import_photo_image" USING btree ("batch_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "recipe_import_photo_image_batch_id_unique" ON "recipe_import_photo_image" USING btree ("batch_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "recipe_import_photo_manifest_batch_version_unique" ON "recipe_import_photo_manifest" USING btree ("batch_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "recipe_import_photo_manifest_batch_key_unique" ON "recipe_import_photo_manifest" USING btree ("batch_id","idempotency_key");
