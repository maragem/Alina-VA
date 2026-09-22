CREATE TYPE "public"."wiki_page_status" AS ENUM('draft', 'published', 'needs_review');--> statement-breakpoint
CREATE TABLE "wiki_page_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"haystack_file_id" uuid,
	"document_id" text,
	"file_name" text NOT NULL,
	"locator" text,
	"quote" text,
	"page_number" integer,
	"authority_rank" integer
);
--> statement-breakpoint
CREATE TABLE "wiki_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid,
	"parent_id" uuid,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"summary" text,
	"content" text DEFAULT '' NOT NULL,
	"status" "wiki_page_status" DEFAULT 'draft' NOT NULL,
	"authority_rank" integer,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"updated_by_user_id" uuid NOT NULL,
	"last_reviewed_at" timestamp with time zone,
	"source_message_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wiki_pages_kb_slug_uq" UNIQUE NULLS NOT DISTINCT("project_id","slug")
);
--> statement-breakpoint
ALTER TABLE "wiki_page_sources" ADD CONSTRAINT "wiki_page_sources_page_id_wiki_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."wiki_pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_pages" ADD CONSTRAINT "wiki_pages_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_pages" ADD CONSTRAINT "wiki_pages_parent_id_wiki_pages_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."wiki_pages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_pages" ADD CONSTRAINT "wiki_pages_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_pages" ADD CONSTRAINT "wiki_pages_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_pages" ADD CONSTRAINT "wiki_pages_source_message_id_messages_id_fk" FOREIGN KEY ("source_message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "wiki_page_sources_page_position_uidx" ON "wiki_page_sources" USING btree ("page_id","position");--> statement-breakpoint
CREATE INDEX "wiki_page_sources_file_idx" ON "wiki_page_sources" USING btree ("haystack_file_id");--> statement-breakpoint
CREATE INDEX "wiki_pages_tree_idx" ON "wiki_pages" USING btree ("project_id","parent_id","sort_order");--> statement-breakpoint
CREATE INDEX "wiki_pages_search_idx" ON "wiki_pages" USING gin (to_tsvector('english', "title" || ' ' || coalesce("summary", '') || ' ' || "content"));
