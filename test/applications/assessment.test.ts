import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApplication } from "@/lib/applications/applications";
import { activeApplicationAssessment, applicationAssessmentState, applicationStateOfRun, latestLaunches, launchApplicationAssessment } from "@/lib/applications/assessment";
import { COORDINATE_ASSESSMENT, launchAssessment } from "@/lib/assessments/launcher";
import { ScopeResolutionError } from "@/lib/assessments/scope-resolver";
import { setSourceEnabled } from "@/lib/catalog/source-records";
import { getConfig } from "@/lib/config";
import type { Db } from "@/lib/db/client";
import { TransitionError } from "@/lib/db/errors";
import { applicationAssessments, assessmentTargets, assessments, initiatives, jobs, repositorySources } from "@/lib/db/schema";
import { DE_WEB_INITIATIVE_ID, deWebInitiative, deleteInitiative, isSystemOwned, listInitiatives, updateInitiative } from "@/lib/initiatives/initiative-records";
import { createTestDb, rawRun } from "../support/db";
import { ana, onboardPortal } from "../support/onboarding";

/*
 * The DE Web assessment of an Application (make-applications-first-class
 * task 3.5, rendering-assessment spec): a Run of the system-owned DE Web
 * initiative, scoped to the Application's repository and linked to it,
 * queued without waiting; one at a time; and a launch that fails recorded.
 */

describe("DE Web assessments", () => {
  let db: Db;
  beforeEach(() => {
    db = createTestDb();
  });

  const payeeHub = () => {
    const access = onboardPortal(db, "Access");
    return createApplication(db, { sealId: "88001", name: "Payee Hub", description: "Payees", repositoryUrl: "https://github.com/acme/payee-hub", portal: access.publicId }, ana);
  };

  it("seeds one DE Web initiative that DE FabLab owns, outside the operator's Assessments (Assessments list)", () => {
    const initiative = deWebInitiative(db);
    expect(initiative).toMatchObject({ publicId: DE_WEB_INITIATIVE_ID, name: "DE Web", deWeb: true, systemOwned: false, claimRepositorySourceId: null, selectionMode: "explicit" });
    expect(isSystemOwned(initiative)).toBe(true);
    // The Assessments list shows it as DE FabLab's own, beside the claims, never in the operator's table.
    expect(listInitiatives(db).map((row) => row.publicId)).not.toContain(DE_WEB_INITIATIVE_ID);
    expect(listInitiatives(db, { systemOwned: true }).map((row) => row.publicId)).not.toContain(DE_WEB_INITIATIVE_ID);
  });

  it("keeps the DE Web initiative's name, objective, and scope, and keeps it", () => {
    const initiative = deWebInitiative(db);
    expect(() => updateInitiative(db, initiative.publicId, initiative.lockVersion, { name: "Mine", objective: "", selectionMode: "all_enabled", sourcePublicIds: [], standardReleasePublicIds: [] })).toThrow(/DE FabLab owns DE Web/);
    expect(() => deleteInitiative(db, initiative.publicId)).toThrow(/owned by DE FabLab and is retained/);
    expect(() => rawRun(db, "update initiatives set name = 'Mine' where public_id = ?", DE_WEB_INITIATIVE_ID)).toThrow(/keeps its name, objective, and scope/);
    expect(() => rawRun(db, "insert into initiatives (public_id, name, selection_mode, de_web, created_at, updated_at) values ('ini_another00000000', 'DE Web 2', 'explicit', 1, 1, 1)")).toThrow(/only DE FabLab creates the DE Web initiative/);
  });

  it("queues a Run of the Application's repository in the DE Web initiative and links it, without waiting (Assessment starts on creation)", () => {
    const application = payeeHub();
    const outcome = launchApplicationAssessment(db, application.publicId, getConfig());
    expect(outcome).toMatchObject({ started: true });
    const run = db.select().from(assessments).where(eq(assessments.publicId, outcome.started ? outcome.assessmentPublicId : "")).get()!;
    expect(run.state).toBe("queued");
    expect(db.select({ publicId: initiatives.publicId }).from(initiatives).where(eq(initiatives.id, run.initiativeId)).get()).toEqual({ publicId: DE_WEB_INITIATIVE_ID });
    expect(db.select({ source: assessmentTargets.repositorySourceId }).from(assessmentTargets).where(eq(assessmentTargets.assessmentId, run.id)).all()).toEqual([{ source: application.repositorySourceId }]);
    expect(db.select({ kind: jobs.kind }).from(jobs).all()).toEqual([{ kind: COORDINATE_ASSESSMENT }]);
    expect(db.select().from(applicationAssessments).all()).toMatchObject([{ applicationId: application.id, assessmentId: run.id, error: null }]);
    expect(latestLaunches(db).get(application.id)).toMatchObject({ error: null, assessment: { publicId: run.publicId, state: "queued" } });
  });

  it("refuses a second launch while one is queued or running, and allows one after it ends", () => {
    const application = payeeHub();
    launchApplicationAssessment(db, application.publicId);
    expect(() => launchApplicationAssessment(db, application.publicId)).toThrow(TransitionError);
    expect(db.select().from(applicationAssessments).all()).toHaveLength(1);
    const active = activeApplicationAssessment(db, application.id)!;
    rawRun(db, "update assessments set state = 'failed', finished_at = ? where id = ?", Date.now(), active.id);
    expect(launchApplicationAssessment(db, application.publicId)).toMatchObject({ started: true });
  });

  it("records a launch that fails, with why, rather than throwing", () => {
    const application = payeeHub();
    const source = db.select().from(repositorySources).where(eq(repositorySources.id, application.repositorySourceId!)).get()!;
    setSourceEnabled(db, source.publicId, false);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(launchApplicationAssessment(db, application.publicId)).toEqual({ started: false, problem: "payee-hub is disabled, so it can't be assessed" });
    expect(db.select().from(applicationAssessments).all()).toMatchObject([{ applicationId: application.id, assessmentId: null, error: "payee-hub is disabled, so it can't be assessed" }]);
    expect(latestLaunches(db).get(application.id)).toMatchObject({ error: "payee-hub is disabled, so it can't be assessed", assessment: null });
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it("starts DE Web Runs only with a scope named at launch, and no other initiative with one", () => {
    expect(() => launchAssessment(db, DE_WEB_INITIATIVE_ID, crypto.randomUUID())).toThrow(ScopeResolutionError);
    expect(() => rawRun(db, "insert into initiative_targets (initiative_id, repository_source_id, created_at) values ((select id from initiatives where public_id = ?), 1, 1)", DE_WEB_INITIATIVE_ID)).toThrow(/names its own repository|FOREIGN KEY/);
  });

  describe("an Application's assessment state", () => {
    it.each([
      ["queued", "queued"],
      ["acquiring", "assessing"],
      ["analyzing", "assessing"],
      ["finalizing", "assessing"],
      ["complete", "assessed"],
      ["complete_with_issues", "assessed_with_issues"],
      ["failed", "failed"],
      ["canceled", "canceled"],
    ] as const)("reads a %s Run as %s", (run, state) => {
      expect(applicationStateOfRun(run)).toBe(state);
    });

    it("is Not assessed before a launch, and Couldn't start with the reason after a failed one", () => {
      const application = payeeHub();
      expect(applicationAssessmentState(db, application.id)).toMatchObject({ state: "not_assessed", run: null, active: false });
      setSourceEnabled(db, db.select().from(repositorySources).where(eq(repositorySources.id, application.repositorySourceId!)).get()!.publicId, false);
      launchApplicationAssessment(db, application.publicId);
      expect(applicationAssessmentState(db, application.id)).toMatchObject({ state: "couldnt_start", reason: "payee-hub is disabled, so it can't be assessed", active: false });
    });

    it("follows the Run, and gives a failed one's reason without the Git error behind it (Unreachable repository)", () => {
      const application = payeeHub();
      const outcome = launchApplicationAssessment(db, application.publicId);
      if (!outcome.started) throw new Error(outcome.problem);
      expect(applicationAssessmentState(db, application.id)).toMatchObject({ state: "queued", active: true, run: { publicId: outcome.assessmentPublicId } });
      const run = db.select().from(assessments).where(eq(assessments.publicId, outcome.assessmentPublicId)).get()!;
      rawRun(db, "update assessment_targets set state = 'failed', failure_code = 'authentication_failed', failure_message = 'fatal: could not read Username for https://ghp_secret@github.com' where assessment_id = ?", run.id);
      rawRun(db, "update assessments set state = 'failed', failure_reason = 'No repository could be assessed', finished_at = ? where id = ?", Date.now(), run.id);
      const state = applicationAssessmentState(db, application.id);
      expect(state).toMatchObject({ state: "failed", active: false, reason: "The repository couldn't be read: DE FabLab has no credential for its host, or the host refused it" });
      expect(state.reason).not.toContain("ghp_secret");
    });
  });
});
