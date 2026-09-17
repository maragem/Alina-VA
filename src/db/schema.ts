import { sql } from "drizzle-orm";
import {
  AnyPgColumn,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const messageRole = pgEnum("message_role", ["user", "assistant"]);
export const messageStatus = pgEnum("message_status", [
  "pending",
  "complete",
  "cancelled",
  "error",
]);
export const projectRole = pgEnum("project_role", ["admin", "member"]);
export const userRole = pgEnum("user_role", ["admin", "member"]);
export const fileScope = pgEnum("file_scope", ["global", "project"]);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
};

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    displayName: text("display_name").notNull(),
    // Login identifier. Nullable for rows created before local authentication;
    // such accounts cannot sign in until an administrator sets an email and password.
    email: text("email"),
    role: userRole("role").default("member").notNull(),
    // scrypt hash produced by `@/lib/password`. Null means "no password set yet".
    passwordHash: text("password_hash"),
    // Set when an administrator issues a temporary password; cleared on first change.
    mustChangePassword: boolean("must_change_password").default(false).notNull(),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    failedLoginAttempts: integer("failed_login_attempts").default(0).notNull(),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("users_email_idx").on(table.email),
    uniqueIndex("users_email_lower_uidx")
      .on(sql`lower(${table.email})`)
      .where(sql`${table.email} is not null`),
  ],
);

export const externalIdentities = pgTable(
  "external_identities",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    providerSubject: text("provider_subject").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("external_identities_provider_subject_uidx").on(
      table.provider,
      table.providerSubject,
    ),
    index("external_identities_user_id_idx").on(table.userId),
  ],
);

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => users.id),
    name: text("name").notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("projects_creator_idx").on(table.createdByUserId),
    index("projects_updated_idx").on(table.updatedAt, table.id),
  ],
);

export const projectMemberships = pgTable(
  "project_memberships",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: projectRole("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("project_memberships_project_user_uidx").on(
      table.projectId,
      table.userId,
    ),
    index("project_memberships_user_project_idx").on(
      table.userId,
      table.projectId,
    ),
  ],
);

export const projectFiles = pgTable(
  "project_files",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    fileId: uuid("file_id").notNull(),
    addedByUserId: uuid("added_by_user_id")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("project_files_project_file_uidx").on(
      table.projectId,
      table.fileId,
    ),
    index("project_files_file_project_idx").on(table.fileId, table.projectId),
  ],
);

export const managedFiles = pgTable(
  "managed_files",
  {
    fileId: uuid("file_id").primaryKey(),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    scope: fileScope("scope").default("global").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("managed_files_owner_idx").on(table.createdByUserId),
    index("managed_files_scope_idx").on(table.scope),
  ],
);

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id),
    title: text("title").notNull(),
    haystackSearchSessionId: uuid("haystack_search_session_id").notNull(),
    haystackPipelineId: uuid("haystack_pipeline_id").notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("conversations_haystack_session_uidx").on(
      table.haystackSearchSessionId,
    ),
    index("conversations_user_updated_idx").on(
      table.userId,
      table.updatedAt,
      table.id,
    ),
    index("conversations_project_idx").on(table.projectId),
  ],
);

export type AttachmentSnapshot = Readonly<{
  fileId: string;
  fileName: string;
}>;

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    replyToMessageId: uuid("reply_to_message_id").references(
      (): AnyPgColumn => messages.id,
      { onDelete: "cascade" },
    ),
    role: messageRole("role").notNull(),
    content: text("content").notNull(),
    status: messageStatus("status").default("complete").notNull(),
    haystackQueryId: uuid("haystack_query_id"),
    haystackResultId: uuid("haystack_result_id"),
    // Snapshot of attachments active when this message was sent, for history display
    attachments: jsonb("attachments").$type<readonly AttachmentSnapshot[]>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("messages_reply_to_uidx")
      .on(table.replyToMessageId)
      .where(sql`${table.replyToMessageId} is not null`),
    index("messages_conversation_created_idx").on(
      table.conversationId,
      table.createdAt,
      table.id,
    ),
  ],
);

export const conversationAttachments = pgTable(
  "conversation_attachments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    // File ID returned by deepset's "Upload Temporary File" endpoint
    haystackFileId: uuid("haystack_file_id").notNull(),
    fileName: text("file_name").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    addedByUserId: uuid("added_by_user_id")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    // Soft-remove: stops being sent on future turns, keeps past message chips intact
    removedAt: timestamp("removed_at", { withTimezone: true }),
  },
  (table) => [
    index("conversation_attachments_active_idx")
      .on(table.conversationId, table.createdAt)
      .where(sql`${table.removedAt} is null`),
  ],
);

export type SourceSnapshot = Readonly<Record<string, unknown>>;

export const messageSources = pgTable(
  "message_sources",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    messageId: uuid("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    documentId: text("document_id"),
    chunkId: text("chunk_id"),
    citationOrder: integer("citation_order").notNull(),
    sourceMetadata: jsonb("source_metadata").$type<SourceSnapshot>().notNull(),
  },
  (table) => [
    uniqueIndex("message_sources_message_order_uidx").on(
      table.messageId,
      table.citationOrder,
    ),
    index("message_sources_document_id_idx").on(table.documentId),
  ],
);