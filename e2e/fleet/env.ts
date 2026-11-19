import path from "node:path";

/**
 * Settings for the synthetic-fleet verification run: its own port, database,
 * and repository storage, and the harness `fleet/` directory as the only
 * allowed source root. Nothing here refers to the fleet's tooling.
 */
export const FLEET_PORT = Number(process.env.FLEET_PORT ?? 3200);
export const FLEET_ROOT = path.resolve(process.env.FLEET_ROOT ?? "../fleet");
const FLEET_RUN = path.resolve("tmp/fleet-run");
export const FLEET_DATABASE = path.join(FLEET_RUN, "frontend-registry.sqlite3");

export const FLEET_ENV = {
  // Shares the browser-test build directory so tsconfig.json never gains another generated include.
  FRONTEND_REGISTRY_NEXT_DIST_DIR: ".next-e2e",
  FRONTEND_REGISTRY_DATABASE: FLEET_DATABASE,
  FRONTEND_REGISTRY_REPOSITORY_STORAGE: path.join(FLEET_RUN, "repositories"),
  FRONTEND_REGISTRY_ALLOWED_ROOTS: FLEET_ROOT,
  // The fleet run never reaches a package registry: Catalog checks and builds find this one unreachable.
  FRONTEND_REGISTRY_CATALOG_REGISTRY: "http://127.0.0.1:9/",
};
