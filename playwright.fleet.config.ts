import { e2eConfig } from "./playwright.base";
import { FLEET_ENV, FLEET_PORT } from "./e2e/fleet/env";

// The synthetic-fleet verification run (npm run test:fleet). It assesses the
// harness fleet/ repositories through the product, so it runs on demand rather
// than with the browser tests, against a throwaway database and storage.
export default e2eConfig({
  testDir: "e2e/fleet",
  port: FLEET_PORT,
  env: FLEET_ENV,
  reset: "rm -rf tmp/fleet-run && mkdir -p tmp/fleet-run",
});
