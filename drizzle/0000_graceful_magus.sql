CREATE TYPE "public"."message_role" AS ENUM('user', 'assistant');--> statement-breakpoint
CREATE TYPE "public"."message_status" AS ENUM('pending', 'complete', 'cancelled', 'error');--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"haystack_search_session_id" uuid NOT NULL,
	"haystack_pipeline_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "external_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_subject" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" uuid NOT NULL,
	"document_id" text,
	"chunk_id" text,
	"citation_order" integer NOT NULL,
	"source_metadata" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"reply_to_message_id" uuid,
	"role" "message_role" NOT NULL,
	"content" text NOT NULL,
	"status" "message_status" DEFAULT 'complete' NOT NULL,
	"haystack_query_id" uuid,
	"haystack_result_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"display_name" text NOT NULL,
	"email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_identities" ADD CONSTRAINT "external_identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_sources" ADD CONSTRAINT "message_sources_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_reply_to_message_id_messages_id_fk" FOREIGN KEY ("reply_to_message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_haystack_session_uidx" ON "conversations" USING btree ("haystack_search_session_id");--> statement-breakpoint
CREATE INDEX "conversations_user_updated_idx" ON "conversations" USING btree ("user_id","updated_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "external_identities_provider_subject_uidx" ON "external_identities" USING btree ("provider","provider_subject");--> statement-breakpoint
CREATE INDEX "external_identities_user_id_idx" ON "external_identities" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "message_sources_message_order_uidx" ON "message_sources" USING btree ("message_id","citation_order");--> statement-breakpoint
CREATE INDEX "message_sources_document_id_idx" ON "message_sources" USING btree ("document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_reply_to_uidx" ON "messages" USING btree ("reply_to_message_id") WHERE "messages"."reply_to_message_id" is not null;--> statement-breakpoint
CREATE INDEX "messages_conversation_created_idx" ON "messages" USING btree ("conversation_id","created_at","id");--> statement-breakpoint
CREATE INDEX "users_email_idx" ON "users" USING btree ("email");