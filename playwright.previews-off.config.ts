import "./e2e/previews-off/env";
import { e2eConfig } from "./playwright.base";
import { E2E_ENV, E2E_PORT, E2E_RESET } from "./e2e/support/env";

// The previews-off run (npm run test:previews-off; applications/onboarding
// spec, "Applications are available while previews are"): the browser tests'
// fixtures against a server with previews off, as a deployment without
// FRONTEND_REGISTRY_PREVIEWS runs. Applications and their addresses don't exist.
export default e2eConfig({
  testDir: "e2e/previews-off",
  port: E2E_PORT,
  env: E2E_ENV,
  reset: E2E_RESET,
});
