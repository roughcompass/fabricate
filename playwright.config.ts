import { e2eConfig } from "./playwright.base";
import { E2E_ENV, E2E_PORT, E2E_RESET } from "./e2e/support/env";

// Browser tests share one server and database, so they run serially. Each
// test resets the data through a route that exists only when FRONTEND_REGISTRY_E2E=1.
export default e2eConfig({
  testDir: "e2e",
  // The synthetic-fleet and demo-off runs have their own configurations (npm run test:fleet and test:demo-off).
  testIgnore: ["fleet/**", "demo-off/**"],
  port: E2E_PORT,
  env: E2E_ENV,
  // A throwaway database, repository store, and allowed source root, beside the kept package cache.
  reset: E2E_RESET,
  reporter: process.env.CI ? "list" : [["list"], ["html", { open: "never" }]],
  reuseExistingServer: !process.env.CI,
});
