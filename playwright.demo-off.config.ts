import "./e2e/demo-off/env";
import { e2eConfig } from "./playwright.base";
import { E2E_ENV, E2E_PORT, E2E_RESET } from "./e2e/support/env";

// The demo-off run (npm run test:demo-off; template-demo/demo-mode spec): the
// browser tests' fixtures against a server with the template demo turned
// off, as a deployment without FRONTEND_REGISTRY_DEMO runs. The demo's pages don't
// exist.
export default e2eConfig({
  testDir: "e2e/demo-off",
  port: E2E_PORT,
  env: { ...E2E_ENV, FRONTEND_REGISTRY_DEMO: "false" },
  reset: E2E_RESET,
});
