import path from "node:path";

/** Settings shared by the browser-test server and the test process. */
export const E2E_PORT = Number(process.env.E2E_PORT ?? 3100);
export const E2E_ROOT = path.resolve("tmp/e2e");
export const E2E_SOURCES = path.join(E2E_ROOT, "sources");
export const E2E_DATABASE = path.join(E2E_ROOT, "fabricate.sqlite3");
/** The DE Console export the server reads; tests write it when they need one. */
export const E2E_DE_CONSOLE = path.join(E2E_ROOT, "de-console.json");

export const E2E_ENV = {
  FABRICATE_E2E: "1",
  FABRICATE_NEXT_DIST_DIR: ".next-e2e",
  FABRICATE_DATABASE: E2E_DATABASE,
  FABRICATE_REPOSITORY_STORAGE: path.join(E2E_ROOT, "repositories"),
  FABRICATE_ALLOWED_ROOTS: E2E_SOURCES,
  FABRICATE_DE_CONSOLE_SOURCE: E2E_DE_CONSOLE,
};
