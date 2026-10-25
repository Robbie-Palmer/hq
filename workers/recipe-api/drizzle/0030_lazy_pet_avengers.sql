CREATE TABLE "shopping_list_command_receipt" (
	"command_id" uuid NOT NULL,
	"actor_user_id" text NOT NULL,
	"resource_id" text NOT NULL,
	"list_id" uuid NOT NULL,
	"base_revision" bigint NOT NULL,
	"command" jsonb NOT NULL,
	"result_revision" bigint NOT NULL,
	"result_snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shopping_list_command_receipt_actor_user_id_command_id_pk" PRIMARY KEY("actor_user_id","command_id")
);
--> statement-breakpoint
ALTER TABLE "shopping_list_command_receipt" ADD CONSTRAINT "shopping_list_command_receipt_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_list_command_receipt" ADD CONSTRAINT "shopping_list_command_receipt_list_id_shopping_list_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."shopping_list"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "shopping_list_command_receipt_list_idx" ON "shopping_list_command_receipt" USING btree ("list_id","created_at");