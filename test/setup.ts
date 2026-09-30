import { loadConfig, setConfig, withOverrides } from "@/lib/config";

// Each Vitest worker gets its own database and managed repository storage.
const worker = process.env.VITEST_POOL_ID ?? "0";

setConfig(
  withOverrides(loadConfig({ environment: "test" }), {
    database: `tmp/test/worker-${worker}/fabricate.sqlite3`,
    repositoryStorage: `tmp/test/worker-${worker}/repositories`,
  }),
);
