// Checks this host's toolchain for preview builds: `npm run previews:doctor`,
// or `node dist/previews-doctor.cjs` in a release. Prints one line per check,
// and exits non-zero when any fails.
import { getConfig } from "@/lib/config";
import { checkToolchain, formatCheck, summarize } from "./doctor";
import { cacheDirectory } from "./storage";

// No top-level await: the release bundles this as CommonJS, like the worker.
async function main(): Promise<boolean> {
  const config = getConfig();
  console.log(`Preview toolchain: previews.nodeVersions, git, and tar. Package manager caches: ${cacheDirectory(config)}`);
  const checks = await checkToolchain(config, { onCheck: (check) => console.log(formatCheck(check)) });
  console.log(summarize(checks));
  return checks.every((check) => check.status !== "failed");
}

void main().then((passed) => {
  process.exitCode = passed ? 0 : 1;
});
