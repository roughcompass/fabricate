import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApplication, getApplication } from "@/lib/applications/applications";
import { launchApplicationAssessment } from "@/lib/applications/assessment";
import { storedDetermination } from "@/lib/applications/determinations";
import type { FabricateConfig } from "@/lib/config";
import type { Db } from "@/lib/db/client";
import { assessments } from "@/lib/db/schema";
import { jobHandlers } from "@/lib/jobs/registry";
import { drainJobs } from "@/lib/jobs/worker";
import { acquisitionConfig } from "../support/acquisition";
import { createTestDb } from "../support/db";
import { GitFixture } from "../support/git-fixture";
import { ana, onboardPortal } from "../support/onboarding";

/*
 * Recording the determination when a DE Web Run finishes
 * (make-applications-first-class task 4.2): a completed Run writes it with
 * its evidence, a later failed Run keeps it, and an Application outside the
 * Run is untouched.
 */

const LIFECYCLES = `export async function bootstrap() {}
export async function mount() {}
export async function unmount() {}
`;

describe("rendering determinations", () => {
  let fixture: GitFixture;
  let config: FabricateConfig;
  let db: Db;

  beforeEach(() => {
    fixture = GitFixture.create("determinations");
    config = acquisitionConfig(fixture);
    db = createTestDb();
  });
  afterEach(() => {
    fixture.cleanup();
    fs.rmSync(config.repositoryStorage, { recursive: true, force: true });
  });

  /** A local repository with +files+, registered as an Application of Access. */
  function application(name: string, files: Record<string, string>) {
    const work = fixture.repo(`fleet/${name}`);
    for (const [file, content] of Object.entries(files)) work.write(file, content);
    work.commit();
    const portal = onboardPortal(db, `${name} Portal`, { slug: name.replace(/[^a-z]/g, "") });
    return createApplication(db, { sealId: "88001", name, description: `${name}, for a test`, repositoryUrl: `file://${work.path}`, portal: portal.publicId }, ana, config);
  }
  const run = () => drainJobs(db, jobHandlers(db, config));
  const runState = (publicId: string) => db.select({ state: assessments.state }).from(assessments).where(eq(assessments.publicId, publicId)).get()!.state;

  it("writes ESM with its evidence when the Run completes, keeps it when a later Run fails, and leaves other Applications alone", async () => {
    const payeeHub = application("payee-hub", { "package.json": '{ "name": "payee-hub", "version": "1.0.0" }\n', "src/main.ts": LIFECYCLES });
    const ledger = application("ledger", { "package.json": '{ "name": "ledger", "version": "1.0.0", "dependencies": { "react": "18.3.1" } }\n' });

    const first = launchApplicationAssessment(db, payeeHub.publicId, config);
    if (!first.started) throw new Error(first.problem);
    await run();
    expect(runState(first.assessmentPublicId)).toBe("complete");

    const assessed = getApplication(db, payeeHub.publicId);
    expect(assessed.renderingMode).toBe("esm");
    expect(assessed.updatedAt.getTime()).toBeGreaterThanOrEqual(payeeHub.updatedAt.getTime());
    const determination = storedDetermination(assessed)!;
    expect(determination).toMatchObject({ mode: "esm", rule: "single-spa-application", assessment: first.assessmentPublicId, profile: expect.stringMatching(/^prf_/) });
    expect(determination.deciding[0]!.evidence[0]).toMatchObject({ path: "src/main.ts", lines: { start: expect.any(Number), end: expect.any(Number) } });
    expect(getApplication(db, ledger.publicId)).toMatchObject({ renderingMode: null, renderingEvidence: null, renderingAssessmentId: null });

    // The repository goes away, so the next Run fails, and the earlier determination stays.
    fs.rmSync(path.join(fixture.root, "fleet/payee-hub"), { recursive: true, force: true });
    const second = launchApplicationAssessment(db, payeeHub.publicId, config);
    if (!second.started) throw new Error(second.problem);
    await run();
    expect(runState(second.assessmentPublicId)).toBe("failed");
    expect(getApplication(db, payeeHub.publicId)).toMatchObject({ renderingMode: "esm", renderingAssessmentId: assessed.renderingAssessmentId });
  }, 60_000);
});
