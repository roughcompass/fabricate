/*
 * The previews-off run (npm run test:previews-off): the browser tests' server
 * and data, beside the main run's, with previews, and so applications, off.
 * The settings are made before e2e/support/env.ts reads them, so the server
 * starts with FRONTEND_REGISTRY_PREVIEWS=0 and the fixtures open this run's
 * database.
 */
process.env.E2E_PREVIEWS = "0";
process.env.E2E_PORT ??= "3400";
process.env.E2E_ROOT ??= "tmp/e2e-previews-off";
process.env.E2E_NEXT_DIST_DIR ??= ".next-e2e-previews-off";
