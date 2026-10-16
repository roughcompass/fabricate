import { defineConfig, devices } from "@playwright/test";
import { HOSTED_ENV, HOSTED_PORT } from "./e2e/hosted/env";

const baseURL = `http://127.0.0.1:${HOSTED_PORT}`;

// The hosted profile (npm run test:hosted; Prototypes design.md, decision 4):
// the server starts with only Prototypes, no Git on its path, and no SQLite
// database, as it does on Vercel.
export default defineConfig({
  testDir: "e2e/hosted",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: { baseURL, trace: "retain-on-failure" },
  projects: [{ name: "chrome", use: { ...devices["Desktop Chrome"], channel: "chrome" } }],
  webServer: {
    // Every command is named by its path, since PATH holds only Node's directory and /bin.
    command: `rm -rf tmp/hosted && mkdir -p tmp/hosted && node node_modules/tsx/dist/cli.mjs src/lib/prototypes/db/migrate-cli.ts && node scripts/build-prototype-runtime.mjs && node node_modules/next/dist/bin/next dev --port ${HOSTED_PORT} --hostname 127.0.0.1`,
    env: HOSTED_ENV,
    url: `${baseURL}/api/health`,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
