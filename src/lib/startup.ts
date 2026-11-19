import { getConfig } from "./config";
import { getDb, pendingMigrationCount } from "./db/client";
import { describeCapability, verifyGit } from "./git/capability";
import { GitRunner } from "./git/runner";
import { PRODUCT } from "./product";

/**
 * Checks shared by the web server (src/instrumentation.ts) and the worker.
 * Any failure throws, so a misconfigured process refuses to start.
 */
export async function verifyStartup(processName: "server" | "worker"): Promise<void> {
  const config = getConfig();
  const git = await verifyGit(new GitRunner({ config }));

  const pending = pendingMigrationCount(getDb());
  if (pending > 0) {
    throw new Error(
      `The database at ${config.database} has ${pending} pending migration(s). ` +
        `Run \`npm run db:migrate\`, or \`node dist/migrate.cjs\` in the production image, before starting the ${PRODUCT.name}.`,
    );
  }

  console.log(
    `[${processName}] ${config.environment} configuration: ${config.allowedRoots.length} allowed root(s), ` +
      `${config.deniedRoots.length} denied root(s), worker concurrency ${config.workerConcurrency}`,
  );
  console.log(`[${processName}] ${describeCapability(git)}`);
}
