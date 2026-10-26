CREATE TABLE "user_follow" (
	"follower_user_id" text NOT NULL,
	"followed_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_follow_pk" PRIMARY KEY("follower_user_id","followed_user_id"),
	CONSTRAINT "user_follow_not_self" CHECK ("user_follow"."follower_user_id" <> "user_follow"."followed_user_id")
);
--> statement-breakpoint
ALTER TABLE "user_follow" ADD CONSTRAINT "user_follow_follower_user_id_user_id_fk" FOREIGN KEY ("follower_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_follow" ADD CONSTRAINT "user_follow_followed_user_id_user_id_fk" FOREIGN KEY ("followed_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_follow_followed_user_id_idx" ON "user_follow" USING btree ("followed_user_id");
