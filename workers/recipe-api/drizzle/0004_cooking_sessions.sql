CREATE TABLE "cooking_session" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"recipe_slug" text NOT NULL,
	"recipe_title" text NOT NULL,
	"servings" integer NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "cooking_session" ADD CONSTRAINT "cooking_session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cooking_session_user_started_idx" ON "cooking_session" USING btree ("user_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "cooking_session_user_completed_idx" ON "cooking_session" USING btree ("user_id","completed_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "cooking_session_user_recipe_completed_idx" ON "cooking_session" USING btree ("user_id","recipe_slug","completed_at" DESC NULLS LAST);
