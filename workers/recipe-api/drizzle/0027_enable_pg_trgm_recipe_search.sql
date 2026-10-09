CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE INDEX "recipe_title_trgm_idx" ON "recipe" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "recipe_description_trgm_idx" ON "recipe" USING gin ("description" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "recipe_body_trgm_idx" ON "recipe" USING gin ("body" gin_trgm_ops);
