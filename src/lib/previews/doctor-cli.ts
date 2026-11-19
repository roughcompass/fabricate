// Checks this host's toolchain for preview builds: `npm run previews:doctor`,
// or `node dist/previews-doctor.cjs` in a release. Prints one line per check,
// and exits non-zero when any fails.
import { getConfig } from "@/lib/config";
import { checkBrowser, checkToolchain, formatCheck, summarize } from "./doctor";
import { cacheDirectory } from "./storage";

// No top-level await: the release bundles this as CommonJS, like the worker.
async function main(): Promise<boolean> {
  const config = getConfig();
  console.log(`Preview toolchain: previews.nodeVersions, git, tar, and the screenshot browser. Package manager caches: ${cacheDirectory(config)}`);
  const onCheck = (check: Parameters<typeof formatCheck>[0]) => console.log(formatCheck(check));
  const checks = [...(await checkToolchain(config, { onCheck })), await checkBrowser(config, { onCheck })];
  console.log(summarize(checks));
  return checks.every((check) => check.status !== "failed");
}

void main().then((passed) => {
  process.exitCode = passed ? 0 : 1;
});
