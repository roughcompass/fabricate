import "./e2e/demo-off/env";
import { defineConfig, devices } from "@playwright/test";
import { E2E_ENV, E2E_PORT, E2E_ROOT, E2E_SOURCES } from "./e2e/support/env";

const baseURL = `http://127.0.0.1:${E2E_PORT}`;

// The demo-off run (npm run test:demo-off; template-demo/demo-mode spec): the
// browser tests' fixtures against a server with the template demo turned
// off, as a deployment without FABRICATE_DEMO runs. The demo's pages don't
// exist.
export default defineConfig({
  testDir: "e2e/demo-off",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: [["list"]],
  use: { baseURL, trace: "retain-on-failure", screenshot: "only-on-failure", reducedMotion: "reduce" },
  projects: [{ name: "chrome", use: { ...devices["Desktop Chrome"], channel: "chrome", viewport: { width: 1280, height: 900 } } }],
  webServer: {
    command: `rm -rf "${E2E_ROOT}" && mkdir -p "${E2E_SOURCES}" && npm run db:migrate && npx next dev --port ${E2E_PORT} --hostname 127.0.0.1`,
    env: { ...E2E_ENV, FABRICATE_DEMO: "false" },
    url: `${baseURL}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
