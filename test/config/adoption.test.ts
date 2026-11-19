import { describe, expect, it } from "vitest";
import { ConfigurationError, loadConfig, withOverrides } from "@/lib/config";

/** Adoption Analytics' settings: how often snapshots are taken, and what counts as rarely used. */
describe("the adoption settings", () => {
  const committed = (env: Record<string, string> = {}, environment: "development" | "test" | "production" = "test") => loadConfig({ appRoot: process.cwd(), environment, env });

  it("take a snapshot weekly and count the bottom quartile of used components as rarely used, in every committed environment", () => {
    for (const environment of ["development", "test", "production"] as const) expect(committed({}, environment).adoption).toEqual({ snapshotDays: 7, rarelyUsedPercentile: 25 });
  });

  it("are set by FRONTEND_REGISTRY_ADOPTION_* variables, and survive overrides of other settings", () => {
    const config = committed({ FRONTEND_REGISTRY_ADOPTION_SNAPSHOT_DAYS: "1", FRONTEND_REGISTRY_ADOPTION_RARELY_USED_PERCENTILE: "10" });
    expect(config.adoption).toEqual({ snapshotDays: 1, rarelyUsedPercentile: 10 });
    expect(withOverrides(config, { workerConcurrency: 1 }).adoption).toEqual(config.adoption);
    expect(withOverrides(config, { adoption: { rarelyUsedPercentile: 50 } }).adoption).toEqual({ snapshotDays: 1, rarelyUsedPercentile: 50 });
  });

  it("reject a percentile outside 1 to 100 and a snapshot interval under a day", () => {
    expect(() => committed({ FRONTEND_REGISTRY_ADOPTION_RARELY_USED_PERCENTILE: "101" })).toThrow(ConfigurationError);
    expect(() => committed({ FRONTEND_REGISTRY_ADOPTION_RARELY_USED_PERCENTILE: "0" })).toThrow(ConfigurationError);
    expect(() => committed({ FRONTEND_REGISTRY_ADOPTION_SNAPSHOT_DAYS: "0" })).toThrow(ConfigurationError);
  });
});
