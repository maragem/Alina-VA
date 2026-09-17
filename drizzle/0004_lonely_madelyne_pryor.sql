CREATE TABLE "conversation_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"haystack_file_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"added_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "attachments" jsonb;--> statement-breakpoint
ALTER TABLE "conversation_attachments" ADD CONSTRAINT "conversation_attachments_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_attachments" ADD CONSTRAINT "conversation_attachments_added_by_user_id_users_id_fk" FOREIGN KEY ("added_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversation_attachments_active_idx" ON "conversation_attachments" USING btree ("conversation_id","created_at") WHERE "conversation_attachments"."removed_at" is null;