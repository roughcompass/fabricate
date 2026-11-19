import path from "node:path";

/** Settings shared by the browser-test server and the test process. */
// E2E_PORT, E2E_ROOT, and E2E_NEXT_DIST_DIR let a second run use its own server and data beside another one.
export const E2E_PORT = Number(process.env.E2E_PORT ?? 3100);
export const E2E_ROOT = path.resolve(process.env.E2E_ROOT ?? "tmp/e2e");
export const E2E_SOURCES = path.join(E2E_ROOT, "sources");
export const E2E_DATABASE = path.join(E2E_ROOT, "fabricate.sqlite3");

/**
 * Repository previews (docs/previews.md) are on, unless E2E_PREVIEWS=0, and
 * only the remotes at these paths under the allowed source root are
 * enrolled, so every other spec's Repositories show no preview controls.
 * Builds run on the Node that runs the tests.
 */
export const E2E_PREVIEWS = process.env.E2E_PREVIEWS !== "0";
export const E2E_PREVIEW_SOURCES = path.join(E2E_SOURCES, "previews");
export const E2E_PREVIEW_REMOTES = ["orders-web", "portal"].map((name) => path.join(E2E_PREVIEW_SOURCES, name));

export const E2E_ENV = {
  FABRICATE_E2E: "1",
  FABRICATE_NEXT_DIST_DIR: process.env.E2E_NEXT_DIST_DIR ?? ".next-e2e",
  FABRICATE_DATABASE: E2E_DATABASE,
  FABRICATE_REPOSITORY_STORAGE: path.join(E2E_ROOT, "repositories"),
  FABRICATE_ALLOWED_ROOTS: E2E_SOURCES,
  FABRICATE_PREVIEWS: E2E_PREVIEWS ? "1" : "0",
  FABRICATE_PREVIEWS_STORAGE: path.join(E2E_ROOT, "previews"),
  FABRICATE_PREVIEWS_TRUSTED_SOURCES: E2E_PREVIEW_REMOTES.map((remote) => `file://${remote}`).join(" "),
  FABRICATE_PREVIEWS_NODE_VERSIONS: `${process.versions.node}=${path.dirname(process.execPath)}`,
};
