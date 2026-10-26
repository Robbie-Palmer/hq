CREATE TABLE "notification_recipe_recommendation_event" (
	"event_id" text PRIMARY KEY NOT NULL,
	"recipe_id" uuid,
	"recipe_slug_snapshot" text NOT NULL,
	"recipe_title_snapshot" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notification_recipe_recommendation_event" ADD CONSTRAINT "notification_recipe_recommendation_event_event_id_notification_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."notification_event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_recipe_recommendation_event" ADD CONSTRAINT "notification_recipe_recommendation_event_recipe_id_recipe_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipe"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notification_recipe_recommendation_recipe_idx" ON "notification_recipe_recommendation_event" USING btree ("recipe_id");
