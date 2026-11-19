// Rewrites the configured database to give back the space migrations and deletions left free: `npm run db:vacuum`.
// It needs free disk about the size of the database while it runs, and no other process may write meanwhile.
import fs from "node:fs";
import { getConfig } from "@/lib/config";
import { openDatabase } from "./client";

const { database } = getConfig();
const before = fs.statSync(database).size;
const db = openDatabase(database);
db.$client.exec("VACUUM");
db.$client.pragma("wal_checkpoint(TRUNCATE)");
db.$client.close();
const after = fs.statSync(database).size;
console.log(`Vacuumed ${database}: ${(before / 2 ** 30).toFixed(2)} GiB to ${(after / 2 ** 30).toFixed(2)} GiB`);
