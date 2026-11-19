import { loadConfig, setConfig, withOverrides } from "@/lib/config";

// Each Vitest worker gets its own database, managed repository storage, and preview storage.
const worker = process.env.VITEST_POOL_ID ?? "0";

setConfig(
  withOverrides(loadConfig({ environment: "test" }), {
    database: `tmp/test/worker-${worker}/frontend-registry.sqlite3`,
    repositoryStorage: `tmp/test/worker-${worker}/repositories`,
    previews: { storage: `tmp/test/worker-${worker}/previews` },
  }),
);
