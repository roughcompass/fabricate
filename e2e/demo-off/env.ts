/*
 * The demo-off run (npm run test:demo-off): the browser tests' server and
 * data, beside the main run's, with the template demo turned off. The
 * defaults are set before e2e/support/env.ts reads them, so the fixtures
 * open this run's database.
 */
process.env.E2E_PORT ??= "3400";
process.env.E2E_ROOT ??= "tmp/e2e-demo-off";
process.env.E2E_NEXT_DIST_DIR ??= ".next-e2e-demo-off";
