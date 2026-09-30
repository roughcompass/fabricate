// Applies committed migrations to the configured database: `npm run db:migrate`.
import { getConfig } from "@/lib/config";
import { migrateDatabase, openDatabase } from "./client";

const { database } = getConfig();
const db = openDatabase(database);
migrateDatabase(db);
db.$client.close();
console.log(`Migrated ${database}`);
