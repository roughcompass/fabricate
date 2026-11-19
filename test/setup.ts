import { loadConfig, setConfig, withOverrides } from "@/lib/config";

// Each Vitest worker gets its own database, managed repository storage, and preview storage.
const worker = process.env.VITEST_POOL_ID ?? "0";

setConfig(
  withOverrides(loadConfig({ environment: "test" }), {
    database: `tmp/test/worker-${worker}/frontend-registry.sqlite3`,
    repositoryStorage: `tmp/test/worker-${worker}/repositories`,
    previews: { storage: `tmp/test/worker-${worker}/previews` },
    // No test reaches a package registry: a Catalog build or check reads the fake registry its test serves, or finds this one unreachable.
    catalog: { registry: "http://127.0.0.1:9/" },
  }),
);
