import crypto from "node:crypto";
import type { JsonObject } from "@repo-facts/contract";
import { describe, expect, it } from "vitest";
import { updateAssessment } from "@/lib/assessments/assessment-records";
import { evaluationReleasesOf, findingDocument, findingsOf } from "@/lib/evaluations/evaluation-records";
import { FINDINGS_PAGE_SIZE, filterFindings } from "@/lib/evaluations/finding-filters";
import { startEvaluation } from "@/lib/evaluations/start";
import { jobHandlers } from "@/lib/jobs/registry";
import { drainJobs } from "@/lib/jobs/worker";
import { releaseById, releaseDocument } from "@/lib/standards/standard-records";
import { buildAssessment, buildRepository } from "../support/builders";
import { createTestDb } from "../support/db";
import { manifest } from "../support/profiles";
import { publishStandard, seedRun } from "../support/scenarios";
import { control } from "../support/standards";

/** An Evaluation of +count+ repositories against two Controls, with the page's view of its Releases. */
async function evaluated(count: number) {
  const db = createTestDb();
  const repositories = Array.from({ length: count }, (_, index) => buildRepository(db, { name: `app-${String(index).padStart(2, "0")}` }));
  const assessment = buildAssessment(db, { repositories });
  const run = await seedRun(db, assessment, repositories, repositories.map((repository) => ({ "package.json": manifest({ name: repository.name, version: "1.0.0" }) })));
  const release = publishStandard(db, "Baseline", [control({ key: "has-ci", title: "Runs continuous integration" }), control({ key: "has-tests", title: "Has tests", condition: { op: "exists", selector: "repository.test_frameworks" } })]);
  const selected = updateAssessment(db, assessment.publicId, assessment.lockVersion, { name: assessment.name, objective: assessment.objective, selectionMode: "all", standardReleasePublicIds: [release.publicId] });
  const { evaluation } = startEvaluation(db, selected.publicId, run.publicId, crypto.randomUUID());
  await drainJobs(db, jobHandlers(db));
  const releases = evaluationReleasesOf(db, evaluation.id).map((pinned) => {
    const document = releaseDocument(releaseById(db, pinned.standardReleaseId));
    return { id: pinned.id, position: pinned.position, titles: new Map((document.controls as JsonObject[]).map((item) => [String(item.key), String(item.title)])) };
  });
  return { db, evaluation, releases };
}

describe("the Evaluation page's Findings", () => {
  it("groups them by Control in the Release's order, counts each, and reads one page of each without a Finding document", async () => {
    const { db, evaluation, releases } = await evaluated(52);
    const view = filterFindings(db, evaluation.id, releases, {}, (_, key) => (key === "has-tests" ? "2" : undefined));

    expect(view).toMatchObject({ total: 104, shown: 104, filtered: false, controls: [["has-tests", "Has tests"], ["has-ci", "Runs continuous integration"]] });
    expect(view.subjects).toHaveLength(52);
    const [ci, tests] = view.byRelease.get(releases[0]!.position)!;
    expect(ci).toMatchObject({ key: "has-ci", title: "Runs continuous integration", total: 52, page: 1, pages: 2, counts: [["gap", 52]] });
    expect(ci!.rows).toHaveLength(FINDINGS_PAGE_SIZE);
    expect(ci!.rows[0]).toMatchObject({ subject: "app-00", outcome: "gap" });
    // Its page in the address: the second page holds the last two.
    expect(tests).toMatchObject({ key: "has-tests", page: 2, pages: 2 });
    expect(tests!.rows.map((row) => row.subject)).toEqual(["app-50", "app-51"]);
    // The rows name the same subjects the Finding documents do.
    const documents = new Map(findingsOf(db, evaluation.id).map((finding) => [finding.publicId, String((findingDocument(finding).subject as JsonObject).name)]));
    for (const row of [...ci!.rows, ...tests!.rows]) expect(row.subject).toBe(documents.get(row.publicId));
  });

  it("keeps the subjects whose name contains the filter's text, in any case, or whose key it is", async () => {
    const { db, evaluation, releases } = await evaluated(12);
    const named = filterFindings(db, evaluation.id, releases, { subject: "APP-1" }, () => undefined);
    expect(named).toMatchObject({ shown: 4, filtered: true, filters: { subject: "APP-1" } });
    expect(named.byRelease.get(releases[0]!.position)!.map((control) => control.rows.map((row) => row.subject))).toEqual([
      ["app-10", "app-11"],
      ["app-10", "app-11"],
    ]);

    const key = findingsOf(db, evaluation.id)[0]!.subjectKey;
    expect(filterFindings(db, evaluation.id, releases, { subject: key }, () => undefined).shown).toBe(2);
    expect(filterFindings(db, evaluation.id, releases, { subject: "nothing like it" }, () => undefined)).toMatchObject({ shown: 0, byRelease: new Map() });
  });
});
