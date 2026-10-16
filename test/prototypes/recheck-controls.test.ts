import { beforeEach, describe, expect, it } from "vitest";
import { requestCancellation } from "@/lib/assessments/transitions";
import { launchTemplateAssessment } from "@/lib/assessments/template-launcher";
import type { Db } from "@/lib/db/client";
import { listEvaluations } from "@/lib/evaluations/evaluation-records";
import { SALT_PATTERNS_INITIATIVE_ID, saltPatternsInitiative, updateReleaseSelections } from "@/lib/initiatives/initiative-records";
import { jobHandlers } from "@/lib/jobs/registry";
import { drainJobs } from "@/lib/jobs/worker";
import { acceptanceReleaseIds, combinedRecheckStatus, controlRecheck } from "@/lib/prototypes/conformance";
import type { TemplateStandards } from "@/lib/prototypes/db/schema";
import { type ExportedVersion, projectFiles } from "@/lib/prototypes/export";
import { MOCK_DATA, mockPage } from "@/lib/prototypes/models/mock-fixtures";
import { DEFAULT_SHELL } from "@/lib/prototypes/seed/defaults";
import { publishDraft } from "@/lib/standards/publish";
import { createStandard } from "@/lib/standards/standard-records";
import { STARTERS } from "@/lib/standards/starters";
import { createTestDb } from "../support/db";

// template-conformance spec: "Re-checks after a Salt upgrade re-evaluate templates" (design decision 10 of converge-templates-and-prototypes).

const page = (code: string): ExportedVersion => ({ prototypeName: "Exception-first queue", number: 1, scope: "page", title: "Urgent payments", navItem: null, code, data: MOCK_DATA, personas: [], shell: DEFAULT_SHELL });
const SALT_PAGE = projectFiles(page(mockPage("Exception-first queue")));
// As if a Salt upgrade removed a token the template uses: every gate still passes, but the token is unknown.
const UNKNOWN_TOKEN = projectFiles(page('import { Text } from "@salt-ds/core";\nexport default function Prototype() {\n  return <Text style={{ color: "var(--salt-made-up-token)" }}>Release payments</Text>;\n}\n'));
const RAW_BUTTON = projectFiles(page('import { Text } from "@salt-ds/core";\nexport default function Prototype() {\n  return (\n    <>\n      <Text>Release payments</Text>\n      <button type="button">Release</button>\n    </>\n  );\n}\n'));

const REF = { key: "ptp_queue00000000000", name: "Urgent payments queue", templatePublicId: "ptp_queue00000000000", templateVersionPublicId: "ptv_queue00000000000", templateVersionNumber: 1, prototypeVersionPublicId: "ver_queue00000000000" };

describe("re-checking a template's Controls", () => {
  let db: Db;
  let releaseIds: string[];

  beforeEach(() => {
    db = createTestDb();
    releaseIds = STARTERS.map((starter) => {
      const { standard, draft } = createStandard(db, { name: starter.name, purpose: starter.purpose }, starter.document);
      return publishDraft(db, standard.publicId, draft.lockVersion).publicId;
    });
    updateReleaseSelections(db, SALT_PATTERNS_INITIATIVE_ID, saltPatternsInitiative(db).lockVersion, releaseIds);
  });

  /** An acceptance's Run and Evaluation of these files, as the template version records them. */
  async function accepted(files: Record<string, string>): Promise<TemplateStandards> {
    const { assessment } = await launchTemplateAssessment(db, REF, { templateFiles: async () => files });
    await drainJobs(db, jobHandlers(db));
    const [evaluation] = listEvaluations(db, { assessmentId: assessment.id });
    return { status: "evaluated", assessmentId: assessment.publicId, evaluationId: evaluation!.publicId };
  }

  /** A re-check's Run of these files, pinned to the acceptance's Releases. */
  async function rechecked(acceptance: TemplateStandards, files: Record<string, string>, finish = true) {
    if (acceptance.status !== "evaluated") throw new Error("Not evaluated");
    const pinned = acceptanceReleaseIds(db, acceptance.evaluationId)!;
    const { assessment } = await launchTemplateAssessment(db, REF, { templateFiles: async () => files, evaluationReleases: pinned });
    if (finish) await drainJobs(db, jobHandlers(db));
    return { assessmentId: assessment.publicId, id: assessment.id };
  }

  it("evaluates a re-check against the Releases its acceptance used, even after the selection changes", async () => {
    const acceptance = await accepted(SALT_PAGE);
    updateReleaseSelections(db, SALT_PATTERNS_INITIATIVE_ID, saltPatternsInitiative(db).lockVersion, [releaseIds[0]!]);
    if (acceptance.status !== "evaluated") throw new Error("Not evaluated");
    expect(acceptanceReleaseIds(db, acceptance.evaluationId)).toEqual(releaseIds);

    const recheck = await rechecked(acceptance, SALT_PAGE);
    const [evaluation] = listEvaluations(db, { assessmentId: recheck.id });
    expect(controlRecheck(db, acceptance, recheck)).toMatchObject({ status: "unchanged", evaluationId: evaluation!.publicId });
    expect(controlRecheck(db, acceptance, recheck)!.controls.length).toBeGreaterThan(10);
    expect(controlRecheck(db, acceptance, recheck)!.controls.every((change) => change.status === "unchanged")).toBe(true);
  });

  it("classifies a Control that turns from Meets to Gap as regressed, naming it (A Control regresses)", async () => {
    const acceptance = await accepted(SALT_PAGE);
    const recheck = await rechecked(acceptance, UNKNOWN_TOKEN);

    const result = controlRecheck(db, acceptance, recheck)!;
    expect(result.status).toBe("regressed");
    // repo-facts reads an inline style's unknown token as an untokenized value, so the token share regresses.
    expect(result.controls).toContainEqual({ release: "Salt exemplary v1", key: "salt-exemplary-token-share", control: "Styles only with Salt tokens", before: "meets", after: "gap", status: "regressed" });
    expect(result.controls.filter((change) => change.status === "regressed").every((change) => change.before === "meets" && change.after !== "meets")).toBe(true);
  });

  it("classifies a Control that turns from Gap to Meets as fixed", async () => {
    const acceptance = await accepted(RAW_BUTTON);
    const recheck = await rechecked(acceptance, SALT_PAGE);

    const result = controlRecheck(db, acceptance, recheck)!;
    expect(result.status).toBe("fixed");
    expect(result.controls).toContainEqual(expect.objectContaining({ key: "salt-exemplary-raw-equivalents", before: "gap", after: "meets", status: "fixed" }));
  });

  it("classifies every Control as broken when the re-check's Assessment fails, and pending while it runs", async () => {
    const acceptance = await accepted(SALT_PAGE);
    const running = await rechecked(acceptance, SALT_PAGE, false);
    expect(controlRecheck(db, acceptance, running)).toEqual({ status: "pending", evaluationId: null, controls: [] });

    requestCancellation(db, running.id);
    await drainJobs(db, jobHandlers(db));
    const result = controlRecheck(db, acceptance, running)!;
    expect(result.status).toBe("broken");
    expect(result.controls.every((change) => change.status === "broken" && change.after === null)).toBe(true);
  });

  it("has nothing to classify for a version that wasn't evaluated at acceptance", async () => {
    expect(controlRecheck(db, { status: "not_evaluated", reason: "no_release" }, { assessmentId: "asm_any0000000000000" })).toBeNull();
    expect(controlRecheck(db, null, null)).toBeNull();
  });

  it("marks the template Regressed for a regressed Control unless its gates make it Broken", () => {
    const controls = (status: "unchanged" | "regressed" | "fixed" | "broken" | "pending") => ({ status, controls: [], evaluationId: null });
    expect(combinedRecheckStatus("unchanged", controls("regressed"))).toBe("regressed");
    expect(combinedRecheckStatus("broken", controls("regressed"))).toBe("broken");
    expect(combinedRecheckStatus("fixed", controls("unchanged"))).toBe("fixed");
    expect(combinedRecheckStatus("unchanged", controls("fixed"))).toBe("fixed");
    expect(combinedRecheckStatus("regressed", controls("fixed"))).toBe("regressed");
    expect(combinedRecheckStatus("unchanged", controls("pending"))).toBe("unchanged");
    expect(combinedRecheckStatus("unchanged", null)).toBe("unchanged");
  });
});
