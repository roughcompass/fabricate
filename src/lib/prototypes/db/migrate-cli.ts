// Applies committed migrations to the configured Prototypes store: `npm run prototypes:migrate`.
import { describePrototypesDatabase, getConfig } from "@/lib/config";
import { migratePrototypesDatabase, openPrototypesDatabase } from "./client";

const { database } = getConfig().prototypes;
const connection = await openPrototypesDatabase(database);
try {
  await migratePrototypesDatabase(connection);
} finally {
  await connection.close();
}
console.log(`Migrated ${describePrototypesDatabase(database)}`);
