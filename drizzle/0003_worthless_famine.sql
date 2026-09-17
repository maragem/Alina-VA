CREATE TYPE "public"."file_scope" AS ENUM('global', 'project');--> statement-breakpoint
ALTER TABLE "managed_files" ADD COLUMN "scope" "file_scope" DEFAULT 'global' NOT NULL;--> statement-breakpoint
CREATE INDEX "managed_files_scope_idx" ON "managed_files" USING btree ("scope");