import path from "node:path";

/** Settings shared by the browser-test server and the test process. */
// E2E_PORT, E2E_ROOT, and E2E_NEXT_DIST_DIR let a second run use its own server and data beside another one.
export const E2E_PORT = Number(process.env.E2E_PORT ?? 3100);
export const E2E_ROOT = path.resolve(process.env.E2E_ROOT ?? "tmp/e2e");
export const E2E_SOURCES = path.join(E2E_ROOT, "sources");
export const E2E_DATABASE = path.join(E2E_ROOT, "fabricate.sqlite3");
/** The DE Console export the server reads; tests write it when they need one. */
export const E2E_DE_CONSOLE = path.join(E2E_ROOT, "de-console.json");
/** The Create Portal dialog's What's included content the server reads: a copy of the committed file, which a test may replace and restore. */
export const E2E_WHATS_INCLUDED = path.join(E2E_ROOT, "portal-whats-included.yaml");

export const E2E_ENV = {
  FABRICATE_E2E: "1",
  FABRICATE_NEXT_DIST_DIR: process.env.E2E_NEXT_DIST_DIR ?? ".next-e2e",
  FABRICATE_DATABASE: E2E_DATABASE,
  FABRICATE_REPOSITORY_STORAGE: path.join(E2E_ROOT, "repositories"),
  FABRICATE_ALLOWED_ROOTS: E2E_SOURCES,
  FABRICATE_DE_CONSOLE_SOURCE: E2E_DE_CONSOLE,
  FABRICATE_WHATS_INCLUDED_FILE: E2E_WHATS_INCLUDED,
  FABRICATE_PROTOTYPES_DATABASE: path.join(E2E_ROOT, "prototypes-pglite"),
  // Browser tests generate with the scripted model, so they never call a model service.
  FABRICATE_PROTOTYPES_MODEL_GENERATE: "mock",
  FABRICATE_PROTOTYPES_MODEL_PLAN: "mock",
  FABRICATE_PROTOTYPES_MODEL_REVIEW: "mock",
  FABRICATE_PROTOTYPES_MODEL_LEARN: "mock",
  // New workspaces start empty; tests of the seeded examples turn them on through the settings route.
  FABRICATE_PROTOTYPES_EXAMPLES: "false",
  // The tests check the limit with a small allowance.
  FABRICATE_PROTOTYPES_DAILY_LIMIT: "30",
};
