// Recreates the assessment projection from stored documents: `npm run projection:rebuild`.
import { getConfig } from "@/lib/config";
import { openDatabase, pendingMigrationCount } from "@/lib/db/client";
import { rebuildProjection } from "./rebuild";

const { database } = getConfig();
const db = openDatabase(database);
try {
  if (pendingMigrationCount(db) > 0) {
    console.error(`${database} has pending migrations. Run npm run db:migrate first.`);
    process.exitCode = 1;
  } else {
    const report = rebuildProjection(db);
    console.log(`Rebuilt the projection of ${database}: ${report.profiles} Profiles and ${report.maps} Relationship Maps`);
    for (const skipped of report.skipped) console.error(`Skipped ${skipped.kind} ${skipped.publicId}: ${skipped.reason}`);
    if (report.skipped.length > 0) process.exitCode = 1;
  }
} finally {
  db.$client.close();
}
