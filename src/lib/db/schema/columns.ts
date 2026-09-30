import { integer, text } from "drizzle-orm/sqlite-core";

export const id = () => integer("id").primaryKey({ autoIncrement: true });
export const publicId = () => text("public_id").notNull().unique();
export const lockVersion = () => integer("lock_version").notNull().default(0);
export const timestamp = (name: string) => integer(name, { mode: "timestamp_ms" });
export const createdAt = () => timestamp("created_at").notNull();
export const updatedAt = () => timestamp("updated_at").notNull();

/** SQL list literal for a CHECK constraint over a closed set of strings. */
export function sqlList(values: readonly string[]): string {
  return values.map((value) => `'${value.replaceAll("'", "''")}'`).join(", ");
}
