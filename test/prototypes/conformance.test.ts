import type { JsonObject } from "@repo-facts/contract";
import { beforeEach, describe, expect, it } from "vitest";
import { launchTemplateAssessment } from "@/lib/assessments/template-launcher";
import type { Db } from "@/lib/db/client";
import { SALT_PATTERNS_INITIATIVE_ID, saltPatternsInitiative, updateReleaseSelections } from "@/lib/initiatives/initiative-records";
import { jobHandlers } from "@/lib/jobs/registry";
import { drainJobs } from "@/lib/jobs/worker";
import { WORKER_GRACE_MS, confirmable, conformanceOf, templateStanding } from "@/lib/prototypes/conformance";
import { type ExportedVersion, projectFiles } from "@/lib/prototypes/export";
import { MOCK_DATA, mockPage } from "@/lib/prototypes/models/mock-fixtures";
import { DEFAULT_SHELL } from "@/lib/prototypes/seed/defaults";
import { publishDraft } from "@/lib/standards/publish";
import { blankDraftDocument, createStandard } from "@/lib/standards/standard-records";
import { STARTERS } from "@/lib/standards/starters";
import { buildRelease } from "../support/builders";
import { createTestDb } from "../support/db";

// template-conformance spec: acceptance requires no Gap and no Indeterminate Finding; templates are Not evaluated when no Release applies.

const VERSION = "ver_queue00000000000";
const page = (code: string): ExportedVersion => ({ prototypeName: "Exception-first queue", number: 1, scope: "page", title: "Urgent payments", navItem: null, code, data: MOCK_DATA, personas: [], shell: DEFAULT_SHELL });
const SALT_PAGE = projectFiles(page(mockPage("Exception-first queue")));
const RAW_BUTTON = projectFiles(page('import { Text } from "@salt-ds/core";\nexport default function Prototype() {\n  return (\n    <>\n      <Text>Release payments</Text>\n      <button type="button">Release</button>\n    </>\n  );\n}\n'));

describe("conformance at acceptance", () => {
  let db: Db;
  beforeEach(() => {
    db = createTestDb();
  });

  const select = (releaseIds: string[]) => updateReleaseSelections(db, SALT_PATTERNS_INITIATIVE_ID, saltPatternsInitiative(db).lockVersion, releaseIds);
  const selectStarters = () =>
    select(
      STARTERS.map((starter) => {
        const { standard, draft } = createStandard(db, { name: starter.name, purpose: starter.purpose }, starter.document);
        return publishDraft(db, standard.publicId, draft.lockVersion).publicId;
      }),
    );
  const launch = async (files: Record<string, string>) =>
    (await launchTemplateAssessment(db, { key: "pro_queue00000000000", name: "Exception-first queue", templatePublicId: null, templateVersionPublicId: null, templateVersionNumber: null, prototypeVersionPublicId: VERSION }, { templateFiles: async () => files })).assessment;
  const finish = () => drainJobs(db, jobHandlers(db));

  it("is Not evaluated, and confirmable on checks alone, while Salt Patterns selects no Release (No Release selected)", () => {
    const result = conformanceOf(db, null, VERSION);
    expect(result).toEqual({ status: "not_evaluated", reason: "no_release" });
    expect(confirmable(result)).toBe(true);
  });

  it("passes a Salt-only page once its Evaluation finishes, and reports each Release's counts (Starting acceptance)", async () => {
    selectStarters();
    const run = await launch(SALT_PAGE);
    expect(conformanceOf(db, run.publicId, VERSION)).toMatchObject({ status: "running", stage: "assessing", stalled: false });
    expect(confirmable(conformanceOf(db, run.publicId, VERSION))).toBe(false);

    await finish();

    const result = conformanceOf(db, run.publicId, VERSION);
    expect(result).toMatchObject({ status: "evaluated", blocking: [] });
    if (result.status !== "evaluated") throw new Error("Not evaluated");
    expect(result.releases.map((release) => release.label)).toEqual(["Salt adherence v1", "Salt exemplary v1"]);
    expect(result.releases.every((release) => release.counts.gap === 0 && release.counts.indeterminate === 0 && release.counts.meets > 0)).toBe(true);
    expect(confirmable(result)).toBe(true);
  });

  it("blocks a raw button, naming Salt exemplary, the Control, and the observed value (A Gap blocks acceptance)", async () => {
    selectStarters();
    const run = await launch(RAW_BUTTON);
    await finish();

    const result = conformanceOf(db, run.publicId, VERSION);
    expect(confirmable(result)).toBe(false);
    if (result.status !== "evaluated") throw new Error("Not evaluated");
    expect(result.blocking).toContainEqual(expect.objectContaining({ release: "Salt exemplary v1", control: "No raw elements that Salt replaces", outcome: "gap", observed: "Observed 1; expected 0" }));
    expect(result.blocking.every((finding) => finding.href.startsWith(`/evaluations/${result.evaluationId}/findings/fnd_`))).toBe(true);
  });

  it("blocks an Indeterminate Finding, naming the missing evidence (Indeterminate blocks acceptance)", async () => {
    // A share of a design system the page doesn't use has nothing to divide.
    const document: JsonObject = {
      ...blankDraftDocument(),
      controls: [{ key: "mui-token-share", title: "Styles with MUI tokens", rationale: "Shares need a denominator.", severity: "medium", subject: "repository", applicability: { op: "contains", selector: "repository.design_systems", mode: "any", values: ["salt"] }, condition: { op: "compare", selector: "repository.design_system_token_share", parameter: "mui", comparator: "gte", value: 80 } }],
    };
    select([buildRelease(db, { document }).publicId]);
    const run = await launch(SALT_PAGE);
    await finish();

    const result = conformanceOf(db, run.publicId, VERSION);
    expect(confirmable(result)).toBe(false);
    if (result.status !== "evaluated") throw new Error("Not evaluated");
    expect(result.blocking).toEqual([expect.objectContaining({ control: "Styles with MUI tokens", outcome: "indeterminate", observed: null, causes: [expect.stringMatching(/nothing to divide/)] })]);
  });

  it("says the worker isn't running once a Run waits past the grace period", async () => {
    selectStarters();
    const run = await launch(SALT_PAGE);
    const later = new Date(run.createdAt.getTime() + WORKER_GRACE_MS + 1);
    expect(conformanceOf(db, run.publicId, VERSION, later)).toMatchObject({ status: "running", stalled: true });
  });

  it("can't be confirmed without the Run it names, or with another version's Run", async () => {
    selectStarters();
    const run = await launch(SALT_PAGE);
    await finish();
    expect(conformanceOf(db, run.publicId, "ver_another000000000")).toEqual({ status: "unavailable", assessmentId: run.publicId });
    expect(conformanceOf(db, "asm_missing000000000", VERSION)).toEqual({ status: "unavailable", assessmentId: "asm_missing000000000" });
    expect(conformanceOf(db, null, VERSION)).toEqual({ status: "unavailable", assessmentId: null });
    for (const result of [conformanceOf(db, run.publicId, "ver_another000000000"), conformanceOf(db, null, VERSION)]) expect(confirmable(result)).toBe(false);
  });

  describe("a template version's standing", () => {
    it("reads Meets with each Release's counts and positions from its recorded Evaluation (Evaluated template)", async () => {
      selectStarters();
      const run = await launch(SALT_PAGE);
      await finish();
      const result = conformanceOf(db, run.publicId, VERSION);
      if (result.status !== "evaluated") throw new Error("Not evaluated");

      const standing = templateStanding(db, { status: "evaluated", assessmentId: run.publicId, evaluationId: result.evaluationId });
      expect(standing).toMatchObject({ status: "meets", reason: null, evaluationId: result.evaluationId });
      expect(standing.releases.map(({ label, position }) => ({ label, position }))).toEqual([
        { label: "Salt adherence v1", position: 0 },
        { label: "Salt exemplary v1", position: 1 },
      ]);
      expect(standing.releases.every((release) => release.counts.meets > 0 && release.counts.gap === 0)).toBe(true);
    });

    it("is Not evaluated, with why, without a Release, before checks existed, or when its Evaluation can't be found (Evaluation unavailable)", () => {
      expect(templateStanding(db, { status: "not_evaluated", reason: "no_release" })).toEqual({ status: "not_evaluated", reason: "No Release was selected on Salt Patterns when it was accepted.", evaluationId: null, releases: [] });
      expect(templateStanding(db, null)).toMatchObject({ status: "not_evaluated", reason: "It was accepted before templates were evaluated against Standards." });
      expect(templateStanding(db, { status: "evaluated", assessmentId: "asm_missing000000000", evaluationId: "evl_missing000000000" })).toMatchObject({ status: "not_evaluated", reason: "Its Evaluation is unavailable." });
    });
  });
});
