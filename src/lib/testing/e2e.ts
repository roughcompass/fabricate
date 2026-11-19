import fs from "node:fs";
import { getConfig } from "@/lib/config";
import { getDb, migrateDatabase, setDb } from "@/lib/db/client";

/**
 * Support for browser tests. These operations exist only when the server is
 * started with FRONTEND_REGISTRY_E2E=1 outside production; otherwise their routes
 * answer 404, so a deployed server can never reset its data.
 */
export function e2eRoutesEnabled(): boolean {
  return process.env.FRONTEND_REGISTRY_E2E === "1" && process.env.NODE_ENV !== "production" && getConfig().environment !== "production";
}

/** Replaces the database, repository storage, and preview storage with empty, migrated ones. */
export function resetE2eData(): void {
  const config = getConfig();
  (globalThis as { __frontendRegistryDb?: { $client: { close(): void } } }).__frontendRegistryDb?.$client.close();
  setDb(undefined);
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${config.database}${suffix}`, { force: true });
  fs.rmSync(config.repositoryStorage, { recursive: true, force: true });
  fs.rmSync(config.previews.storage, { recursive: true, force: true });
  migrateDatabase(getDb());
}
