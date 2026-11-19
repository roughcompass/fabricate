import { beforeEach, describe, expect, it } from "vitest";
import { scheduleCatalogChecks } from "@/lib/catalog/check";
import { storeEntry } from "@/lib/catalog/entries";
import { entriesInUse } from "@/lib/catalog/current";
import { recipeProgress, recipeStates } from "@/lib/catalog/updates";
import { getConfig } from "@/lib/config";
import type { Db } from "@/lib/db/client";
import { nextScheduledChecks, scheduleProfileChecks } from "@/lib/profiling/check";
import { deleteRepository } from "@/lib/repositories/registration";
import { currentRecipe, moveSurvey, requestSurvey } from "@/lib/surveys/records";
import { buildRepository } from "../support/builders";
import { saltEntry } from "../support/catalog";
import { sealEntry } from "@repo-facts/contract";
import { createTestDb } from "../support/db";
import { manifest, sha1 } from "../support/profiles";
import { seedSurvey } from "../support/scenarios";

/*
 * What the system status page reads (establish-frontend-registry, design
 * decision 8): the entries in use, the next checks, and re-survey progress
 * (the system-status scenario "After a Surveyor upgrade").
 */

const SALT_APP = { "package.json": manifest({ name: "web", version: "1.0.0", dependencies: { "@salt-ds/core": "1.75.0" } }), "src/App.tsx": 'import { Button } from "@salt-ds/core";\nexport const App = () => <Button>Go</Button>;\n' };

describe("system status", () => {
  let db: Db;
  const config = getConfig();
  beforeEach(() => {
    db = createTestDb();
  });

  it("lists the current entry of each version in use", () => {
    expect(entriesInUse(db, config)).toEqual([]);
    const { entry } = storeEntry(db, saltEntry());
    expect(entriesInUse(db, config)).toEqual([entry]);
  });

  it("names when the next profiling check and Catalog check are due", () => {
    expect(nextScheduledChecks(db)).toEqual({ profiling: null, catalog: null });
    const now = new Date("2026-11-19T09:30:00.000Z");
    scheduleProfileChecks(db, config, now);
    scheduleCatalogChecks(db, now);
    expect(nextScheduledChecks(db)).toEqual({ profiling: now, catalog: now });
  });

  it("counts Repositories made with the current recipe, waiting for it, and failed (After a Surveyor upgrade)", async () => {
    storeEntry(db, saltEntry());
    const current = await seedSurvey(db, buildRepository(db, { name: "current" }), { files: SALT_APP });
    const earlier = buildRepository(db, { name: "earlier" });
    const older = requestSurvey(db, { repositoryId: earlier.id, commitSha: sha1("earlier"), reference: "refs/heads/main", fromConfiguredReference: true, trigger: "added", ...currentRecipe(config), surveyorRelease: "0.6.0" }).survey;
    expect(older.state).toBe("queued");
    const failed = buildRepository(db, { name: "failed" });
    const failing = requestSurvey(db, { repositoryId: failed.id, commitSha: sha1("failed"), reference: "refs/heads/main", fromConfiguredReference: true, trigger: "added", ...currentRecipe(config) }).survey;
    moveSurvey(db, failing, "failed", { failureCode: "source_unavailable", failureMessage: "The remote is down" });
    const unsurveyed = buildRepository(db, { name: "unsurveyed" });
    const gone = buildRepository(db, { name: "gone" });
    deleteRepository(db, gone.publicId, "gone");

    expect(recipeStates(db, config)).toEqual(
      new Map([
        [current.repositoryId, "current"],
        [earlier.id, "waiting"],
        [failed.id, "failed"],
        [unsurveyed.id, "waiting"],
      ]),
    );
    expect(recipeProgress(db, config)).toEqual({ current: 1, waiting: 2, failed: 1 });

    // A rebuilt entry the current survey used puts it back to waiting.
    const { digest: _digest, ...unsealed } = saltEntry();
    storeEntry(db, sealEntry({ ...unsealed, built_at: "2026-11-20T00:00:00.000Z", content: { ...unsealed.content, neutral_tags: [...unsealed.content.neutral_tags!, "figure"].sort() } } as never));
    expect(recipeProgress(db, config)).toEqual({ current: 0, waiting: 3, failed: 1 });
  });
});
