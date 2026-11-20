// Applies committed migrations to the configured database: `npm run db:migrate`.
import { supersededBitbucketTokens } from "@/lib/admin/bitbucket-tokens";
import { getConfig } from "@/lib/config";
import { migrateDatabase, openDatabase } from "./client";

const { database } = getConfig();
const db = openDatabase(database);
// Migration 0057 keeps one Bitbucket token per server and deletes the rest; read them first, to say which went.
const superseded = supersededBitbucketTokens(db);
migrateDatabase(db);
db.$client.close();
console.log(`Migrated ${database}`);
for (const token of superseded) {
  console.warn(
    `Deleted the Bitbucket token ending in ${token.tokenHint}, saved for ${token.name}, for ${token.serverUrl}: a server has one token now, and its newest was kept. ` +
      "Revoke the deleted token in Bitbucket, or, to use that owner's access instead, delete the kept token under Admin and save a new one.",
  );
}
