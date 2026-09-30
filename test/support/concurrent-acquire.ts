// Child process for the concurrent acquisition test. Acquires one target in
// a shared database with a Git wrapper that logs each invocation.
//
//   tsx test/support/concurrent-acquire.ts <config.json> <target public id> <git wrapper>
import fs from "node:fs";
import { acquireSnapshot } from "@/lib/acquisition/acquire";
import { getTarget } from "@/lib/assessments/assessment-records";
import { type FabricateConfig, loadConfig, setConfig, withOverrides } from "@/lib/config";
import { openDatabase } from "@/lib/db/client";
import { GitRunner } from "@/lib/git/runner";

const [configFile, targetPublicId, gitWrapper] = process.argv.slice(2);
const settings = JSON.parse(fs.readFileSync(configFile!, "utf8")) as { database: string; storage: string; allowedRoot: string };
const config: FabricateConfig = withOverrides(loadConfig({ environment: "test" }), {
  database: settings.database,
  repositoryStorage: settings.storage,
  allowedRoots: [settings.allowedRoot],
});
setConfig(config);

const db = openDatabase(settings.database);
const snapshot = await acquireSnapshot(db, getTarget(db, targetPublicId!), { config, runner: new GitRunner({ config, executable: gitWrapper }) });
process.stdout.write(JSON.stringify({ commitSha: snapshot.commitSha }));
db.$client.close();
