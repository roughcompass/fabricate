import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { TAKE_SNAPSHOTS, compareSnapshots, latestSnapshot, runSnapshots, scheduleAdoptionSnapshots, snapshotsOf, takeSnapshots } from "@/lib/adoption/snapshots";
import { storeEntry } from "@/lib/catalog/entries";
import { getConfig, withOverrides } from "@/lib/config";
import type { Db } from "@/lib/db/client";
import { adoptionSnapshots, jobs } from "@/lib/db/schema";
import { jobPayload } from "@/lib/jobs/queue";
import { jobHandlers } from "@/lib/jobs/registry";
import { drainJobs } from "@/lib/jobs/worker";
import { buildRepository } from "../support/builders";
import { saltEntry } from "../support/catalog";
import { createTestDb, rawRun } from "../support/db";
import { manifest } from "../support/profiles";
import { seedSurvey } from "../support/scenarios";

/*
 * Adoption snapshots (establish-frontend-registry, task 6.3): a weekly,
 * configurable job records each tracked design system's and package's
 * figures, and each figure's change against the previous snapshot.
 */

const app = (name: string, components: string) => ({
  "package.json": manifest({ name, version: "1.0.0", dependencies: { "@salt-ds/core": "1.75.0" } }),
  "src/App.tsx": `import { Button, Text } from "@salt-ds/core";\nexport const App = () => <main>${components}</main>;\n`,
});

const WEEK_1 = new Date("2026-11-19T09:00:00.000Z");
const WEEK_2 = new Date("2026-11-26T09:00:00.000Z");

describe("adoption snapshots", () => {
  let db: Db;
  const config = getConfig();
  const salt = () => latestSnapshot(db, "design_system", "salt")!;

  beforeEach(async () => {
    db = createTestDb();
    storeEntry(db, saltEntry());
    await seedSurvey(db, buildRepository(db, { name: "web" }), { files: app("web", "<Button>Go</Button><Button>Back</Button>") });
  });

  it("records each tracked design system and package, with no change shown on the first snapshot", () => {
    const taken = takeSnapshots(db, config, "2026-11-19T00:00:00.000Z", WEEK_1);
    expect(taken.map((snapshot) => `${snapshot.kind} ${snapshot.subject}`)).toEqual(["design_system salt", "package @salt-ds/core", "package @salt-ds/theme", "package @salt-ds/icons"]);

    const first = salt();
    expect(first.earlier).toBeNull();
    expect(first.later).toMatchObject({ takenAt: WEEK_1, entryDigest: saltEntry().digest, counts: { Button: 2 } });
    expect(first.later.figures).toMatchObject({ registered: 1, covered: 1, repositories: 1, components_tracked: saltEntry().content.components!.length, components_used: 1, usages: 2 });
    expect(Object.values(first.figures).every((change) => change === null)).toBe(true);
    expect(latestSnapshot(db, "package", "@salt-ds/core")!.later).toMatchObject({ figures: { profiled: 1, repositories: 1, resolved: 0, unresolved: 1 }, counts: {} });
  });

  it("shows each figure's change since the previous snapshot (Weekly change), and compares any two", async () => {
    takeSnapshots(db, config, "2026-11-19T00:00:00.000Z", WEEK_1);
    await seedSurvey(db, buildRepository(db, { name: "orders" }), { files: app("orders", "<Text>Orders</Text><Button>Pay</Button>") });
    takeSnapshots(db, config, "2026-11-26T00:00:00.000Z", WEEK_2);

    const second = salt();
    expect(second.later.figures).toMatchObject({ repositories: 2, components_used: 2, usages: 4 });
    expect(second.figures).toMatchObject({ registered: 1, covered: 1, repositories: 1, components_used: 1, usages: 2, components_unused: -1 });
    expect(second.counts).toEqual({ Button: 1, Text: 1 });

    const [week1, week2] = snapshotsOf(db, "design_system", "salt");
    // Comparing reads two rows, in either order.
    expect(compareSnapshots(db, week2!.id, week1!.id)).toEqual(second);
    expect(snapshotsOf(db, "design_system", "salt", WEEK_2).map((snapshot) => snapshot.id)).toEqual([week1!.id]);
    expect(() => compareSnapshots(db, week1!.id, latestSnapshot(db, "package", "@salt-ds/core")!.later.id)).toThrow(/aren't of one subject/);
  });

  it("takes one snapshot per subject per period, and none of a design system with no entry", () => {
    takeSnapshots(db, config, "2026-11-19T00:00:00.000Z", WEEK_1);
    expect(takeSnapshots(db, config, "2026-11-19T00:00:00.000Z", WEEK_1)).toEqual([]);
    expect(db.select().from(adoptionSnapshots).all()).toHaveLength(4);
    expect(() => rawRun(db, "update adoption_snapshots set figures = '{}'")).toThrow(/never change/);

    const empty = createTestDb();
    expect(takeSnapshots(empty, config, "2026-11-19T00:00:00.000Z", WEEK_1).map((snapshot) => snapshot.kind)).toEqual(["package", "package", "package"]);
  });

  it("runs weekly by default, every adoption.snapshotDays when configured, from when the worker starts", async () => {
    const weekly = scheduleAdoptionSnapshots(db, config, WEEK_1);
    expect(weekly.map((job) => [job.kind, job.runAfter.toISOString()])).toEqual([
      [TAKE_SNAPSHOTS, WEEK_1.toISOString()],
      [TAKE_SNAPSHOTS, "2026-11-26T00:00:00.000Z"],
    ]);
    expect(scheduleAdoptionSnapshots(db, config, new Date(WEEK_1.getTime() + 60_000)).map((job) => job.id)).toEqual(weekly.map((job) => job.id));

    await drainJobs(db, jobHandlers(db, config), { now: () => WEEK_1 });
    expect(db.select().from(jobs).where(eq(jobs.id, weekly[0]!.id)).get()).toMatchObject({ state: "succeeded" });
    expect(salt().later.slot).toBe(jobPayload(weekly[0]!).slot);

    const daily = withOverrides(config, { adoption: { snapshotDays: 1 } });
    const taken = runSnapshots(createTestDb(), daily, { now: WEEK_1 });
    expect(taken.every((snapshot) => snapshot.slot === "2026-11-19T00:00:00.000Z")).toBe(true);
  });
});
