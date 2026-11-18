import {
  boolean,
  integer,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { organization } from "./schema.js";

/** Search connections are intentionally separate from LLM provider connections. */
export const SEARCH_PROVIDER_TYPES = ["searxng", "tavily", "brave"] as const;
export type SearchProviderType = (typeof SEARCH_PROVIDER_TYPES)[number];

export const searchProviderConnections = pgTable(
  "search_provider_connections",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    provider: text("provider", { enum: SEARCH_PROVIDER_TYPES }).notNull(),
    name: text("name").notNull(),
    // Self-hosted SearXNG has no credential. Paid providers keep exactly the
    // existing encrypted credential envelope; plaintext is never persisted.
    encryptedApiKey: text("encrypted_api_key"),
    keyIv: text("key_iv"),
    keyAuthTag: text("key_auth_tag"),
    keyVersion: text("key_version").notNull().default("v1"),
    enabled: boolean("enabled").notNull().default(true),
    priority: integer("priority").notNull().default(100),
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    circuitOpenUntil: timestamp("circuit_open_until", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("search_provider_connections_org_idx").on(table.organizationId),
    uniqueIndex("search_provider_connections_org_provider_name_uq").on(table.organizationId, table.provider, table.name),
    uniqueIndex("search_provider_connections_id_org_uq").on(table.id, table.organizationId),
  ],
);

export type SearchProviderConnection = typeof searchProviderConnections.$inferSelect;
export type NewSearchProviderConnection = typeof searchProviderConnections.$inferInsert;
