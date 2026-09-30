import { defineConfig, devices } from "@playwright/test";
import { FLEET_ENV, FLEET_PORT } from "./e2e/fleet/env";

const baseURL = `http://127.0.0.1:${FLEET_PORT}`;

// The synthetic-fleet verification run (npm run test:fleet). It assesses the
// harness fleet/ repositories through the product, so it runs on demand rather
// than with the browser tests, against a throwaway database and storage.
export default defineConfig({
  testDir: "e2e/fleet",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    reducedMotion: "reduce",
  },
  projects: [
    {
      name: "chrome",
      use: { ...devices["Desktop Chrome"], channel: "chrome", viewport: { width: 1280, height: 900 } },
    },
  ],
  webServer: {
    command: `rm -rf tmp/fleet-run && mkdir -p tmp/fleet-run && npm run db:migrate && npx next dev --port ${FLEET_PORT} --hostname 127.0.0.1`,
    env: FLEET_ENV,
    url: `${baseURL}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
