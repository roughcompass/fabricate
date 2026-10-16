import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getAssessment, targetsOf } from "@/lib/assessments/assessment-records";
import { type TemplateVersionRef, evaluateTemplateRun, launchTemplateAssessment } from "@/lib/assessments/template-launcher";
import { getConfig, loadConfig, setConfig, withOverrides } from "@/lib/config";
import type { Db } from "@/lib/db/client";
import { newWorkspaceKey } from "@/lib/demo/workspace-key";
import { type Finding, findingsOf, listEvaluations } from "@/lib/evaluations/evaluation-records";
import { SALT_PATTERNS_INITIATIVE_ID, saltPatternsInitiative, updateReleaseSelections } from "@/lib/initiatives/initiative-records";
import { jobHandlers } from "@/lib/jobs/registry";
import { drainJobs } from "@/lib/jobs/worker";
import { profileDocument, profilesOf } from "@/lib/profiles/profile-records";
import { type PrototypesConnection, setPrototypesDb } from "@/lib/prototypes/db/client";
import { personas, prototypes, variants } from "@/lib/prototypes/db/schema";
import { startGeneration } from "@/lib/prototypes/pipeline/start";
import { keepVariant } from "@/lib/prototypes/variants";
import { ensurePrototypesWorkspace } from "@/lib/prototypes/workspace";
import { publishDraft } from "@/lib/standards/publish";
import { createStandard } from "@/lib/standards/standard-records";
import { STARTERS } from "@/lib/standards/starters";
import { orchestrateGeneration } from "@/workflows/prototypes/orchestrate";
import { createTestDb } from "../support/db";
import { createPrototypesTestDb } from "../support/prototypes-db";

/*
 * launchTemplateAssessment and the Evaluation that follows a finished Salt
 * Patterns Run (converge-templates-and-prototypes, design decision 2;
 * static-assessments spec, reproducibility): assessing the same version twice
 * gives the same content digest and equivalent facts and Findings.
 */

describe("template assessments", () => {
  let db: Db;
  let connection: PrototypesConnection;
  let workspaceId: string;
  const original = getConfig();

  beforeEach(async () => {
    setConfig(withOverrides(loadConfig({ environment: "test" }), { prototypes: { models: { generate: "mock", plan: "mock", review: "mock", learn: "mock" } } }));
    db = createTestDb();
    connection = await createPrototypesTestDb();
    await setPrototypesDb(connection);
    workspaceId = (await ensurePrototypesWorkspace(connection.db, newWorkspaceKey())).id;
  });

  afterEach(async () => {
    await setPrototypesDb(undefined);
    setConfig(original);
  });

  /** A kept page version, as the accept step would name it before its first acceptance. */
  async function keptPage(): Promise<TemplateVersionRef> {
    const [approver] = await connection.db.select().from(personas).where(eq(personas.workspaceId, workspaceId)).orderBy(personas.createdAt);
    const generationId = await startGeneration(connection.db, workspaceId, { intent: "Review and release today's urgent payments before cut-off", scope: "page", personaIds: [approver!.id], variants: 1 });
    await orchestrateGeneration(generationId);
    const [variant] = await connection.db.select().from(variants).where(eq(variants.generationId, generationId));
    const { prototypeId } = await keepVariant(connection.db, workspaceId, variant!.id, "");
    const [prototype] = await connection.db.select().from(prototypes).where(eq(prototypes.id, prototypeId));
    return { key: prototypeId, name: prototype!.name, templatePublicId: null, templateVersionPublicId: null, templateVersionNumber: null, prototypeVersionPublicId: variant!.versionId! };
  }

  function selectSaltStarters(): void {
    const releases = STARTERS.map((starter) => {
      const { standard, draft } = createStandard(db, { name: starter.name, purpose: starter.purpose }, starter.document);
      return publishDraft(db, standard.publicId, draft.lockVersion);
    });
    updateReleaseSelections(db, SALT_PATTERNS_INITIATIVE_ID, saltPatternsInitiative(db).lockVersion, releases.map((release) => release.publicId));
  }

  async function assess(ref: TemplateVersionRef) {
    const { assessment } = await launchTemplateAssessment(db, ref);
    await drainJobs(db, jobHandlers(db));
    return getAssessment(db, assessment.publicId);
  }

  /** What a Finding concludes, without the identities that differ between Runs. */
  const conclusion = (finding: Finding) => ({ control: finding.controlKey, subject: finding.subjectType, outcome: finding.outcome, severity: finding.severity, position: finding.position });

  it("assesses a version twice with the same digest, equivalent facts, and equivalent Findings against the selected Releases", async () => {
    selectSaltStarters();
    const ref = await keptPage();

    const [first, second] = [await assess(ref), await assess(ref)];

    expect([first.state, second.state]).toEqual(["complete", "complete"]);
    expect(first.initiativeId).toBe(saltPatternsInitiative(db).id);
    const [a, b] = [targetsOf(db, first.id)[0]!, targetsOf(db, second.id)[0]!];
    expect(a).toMatchObject({ kind: "template", sourcePublicId: ref.key, prototypeVersionPublicId: ref.prototypeVersionPublicId });
    expect(b.contentDigest).toBe(a.contentDigest);

    const facts = (assessmentId: number) => {
      const document = profileDocument(profilesOf(db, assessmentId)[0]!.profile);
      return { digest: document.content_digest, facts: document.fact_document_digest };
    };
    expect(facts(second.id)).toEqual(facts(first.id));

    const [firstEvaluation] = listEvaluations(db, { assessmentId: first.id });
    const [secondEvaluation] = listEvaluations(db, { assessmentId: second.id });
    expect([firstEvaluation?.state, secondEvaluation?.state]).toEqual(["complete", "complete"]);
    const findings = findingsOf(db, firstEvaluation!.id);
    expect(findings.length).toBeGreaterThan(0);
    // The export's own shell and entry meet both Salt starters, so a Salt-only page has nothing to fix (repo-facts 0.3.0).
    expect(findings.filter((finding) => finding.outcome !== "meets").map(conclusion)).toEqual([]);
    expect(findingsOf(db, secondEvaluation!.id).map(conclusion)).toEqual(findings.map(conclusion));
  });

  it("evaluates nothing while Salt Patterns selects no Release, and starts a finished Run's Evaluation only once", async () => {
    const run = await assess(await keptPage());

    expect(run.state).toBe("complete");
    expect(listEvaluations(db, { assessmentId: run.id })).toEqual([]);

    selectSaltStarters();
    const evaluation = evaluateTemplateRun(db, run);
    expect(evaluation).not.toBeNull();
    expect(evaluateTemplateRun(db, run)?.id).toBe(evaluation!.id);
    expect(listEvaluations(db, { assessmentId: run.id })).toHaveLength(1);
  });

  it("refuses a version that doesn't exist before starting any Run", async () => {
    await expect(launchTemplateAssessment(db, { key: "pro_gone000000000000", name: "Gone", templatePublicId: null, templateVersionPublicId: null, templateVersionNumber: null, prototypeVersionPublicId: "ver_gone000000000000" })).rejects.toThrow(/no longer exists/);
    expect(db.$client.prepare("select count(*) as n from assessments").get()).toEqual({ n: 0 });
  });
});
