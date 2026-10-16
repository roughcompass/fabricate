import { type PrototypesConnection, migratePrototypesDatabase, openPrototypesDatabase } from "@/lib/prototypes/db/client";

/** A fresh in-memory Prototypes store with every committed migration applied. Close it after the test. */
export async function createPrototypesTestDb(): Promise<PrototypesConnection> {
  const connection = await openPrototypesDatabase({ kind: "memory" });
  await migratePrototypesDatabase(connection);
  return connection;
}
