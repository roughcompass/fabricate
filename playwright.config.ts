import { defineConfig, devices } from "@playwright/test";
import { E2E_ENV, E2E_PORT, E2E_ROOT, E2E_SOURCES } from "./e2e/support/env";

const baseURL = `http://127.0.0.1:${E2E_PORT}`;

// Browser tests share one server and database, so they run serially. Each
// test resets the data through a route that exists only when FABRICATE_E2E=1.
export default defineConfig({
  testDir: "e2e",
  // The synthetic-fleet, hosted-profile, and demo-off runs have their own configurations (npm run test:fleet, test:hosted, and test:demo-off).
  testIgnore: ["fleet/**", "hosted/**", "demo-off/**"],
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: process.env.CI ? "list" : [["list"], ["html", { open: "never" }]],
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
  // A throwaway database, repository store, and allowed source root.
  webServer: {
    command: `rm -rf "${E2E_ROOT}" && mkdir -p "${E2E_SOURCES}" && npm run db:migrate && npm run prototypes:migrate && npm run prototypes:runtime && npx next dev --port ${E2E_PORT} --hostname 127.0.0.1`,
    env: E2E_ENV,
    url: `${baseURL}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
