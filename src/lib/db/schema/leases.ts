import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { repositorySources } from "./catalog";
import { timestamp } from "./columns";

/**
 * Serializes updates to one source's managed object database across worker
 * processes. A lease expires on its own if its holder stops without releasing
 * it, and the holder renews it while Git runs.
 */
export const sourceLeases = sqliteTable("source_leases", {
  repositorySourceId: integer("repository_source_id")
    .primaryKey()
    .references(() => repositorySources.id, { onDelete: "restrict" }),
  holder: text("holder").notNull(),
  acquiredAt: timestamp("acquired_at").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
});
