// Checks this host's toolchain for preview builds: `npm run previews:doctor`.
// Prints one line per check, and exits non-zero when any fails.
import { getConfig } from "@/lib/config";
import { checkToolchain, formatCheck, summarize } from "./doctor";
import { cacheDirectory } from "./storage";

const config = getConfig();
console.log(`Preview toolchain: previews.nodeVersions, git, and tar. Package manager caches: ${cacheDirectory(config)}`);
const checks = await checkToolchain(config, { onCheck: (check) => console.log(formatCheck(check)) });
console.log(summarize(checks));
process.exitCode = checks.some((check) => check.status === "failed") ? 1 : 0;
