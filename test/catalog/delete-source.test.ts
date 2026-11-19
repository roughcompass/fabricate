import { beforeEach, describe, expect, it } from "vitest";
import { resolveScope } from "@/lib/runs/scope-resolver";
import { deleteSource, deletionEffects, registerSource } from "@/lib/catalog/catalog";
import { type RepositorySource, findSource, findSourceIncludingDeleted, listSources } from "@/lib/catalog/source-records";
import { SourceBoundary } from "@/lib/catalog/source-boundary";
import { getConfig } from "@/lib/config";
import type { Db } from "@/lib/db/client";
import { ValidationError } from "@/lib/db/errors";
import { fleetSummary } from "@/lib/home/summary";
import { selectedSources } from "@/lib/assessments/assessment-records";
import { deletePreview } from "@/lib/previews/lifecycle";
import { versionsOf } from "@/lib/profiling/versions";
import { requestSurvey } from "@/lib/surveys/records";
import { buildRun, buildAssessment, buildSource } from "../support/builders";
import { createTestDb, rawRun } from "../support/db";
import { queuedPreview } from "../support/previews";

describe("deleting a Repository", () => {
  let db: Db;
  beforeEach(() => {
    db = createTestDb();
  });
  /** A queued survey of +source+'s configured reference, as background surveying requests once the reference resolves. */
  const surveyQueued = (source: RepositorySource) =>
    requestSurvey(db, { repositorySourceId: source.id, commitSha: "a".repeat(40), reference: "refs/heads/main", fromConfiguredReference: true, trigger: "added", surveyorRelease: "0.6.0", configurationDigest: "f".repeat(64), profileSchemaVersion: 2 }).survey;

  it("refuses anything but its exact name as confirmation, and changes nothing", () => {
    const orders = buildSource(db, { name: "orders" });
    for (const typed of ["", "order", "Orders", "orders2"]) expect(() => deleteSource(db, orders.publicId, typed)).toThrow(ValidationError);
    expect(findSource(db, orders.publicId)).toBeDefined();
  });

  it("states what deleting changes: its versions, the Assessments that select it, and the Runs that keep its results", () => {
    const boundary = new SourceBoundary(getConfig());
    const orders = registerSource(db, { name: "orders", cloneUrl: "https://git.example.com/acme/orders.git", gitRef: "" }, boundary);
    surveyQueued(orders);
    buildAssessment(db, { name: "Checkout", sources: [orders] });
    buildRun(db, { sources: [orders] });

    expect(deletionEffects(db, orders)).toEqual({ versions: 1, assessments: ["Checkout"], runs: 1, previews: 0 });
  });

  it("counts its undeleted previews, which are deleted with it", async () => {
    const orders = buildSource(db, { name: "orders" });
    queuedPreview(db, orders);
    const deleted = queuedPreview(db, orders);
    queuedPreview(db, buildSource(db, { name: "billing" }));
    await deletePreview(db, deleted.publicId);

    expect(deletionEffects(db, orders).previews).toBe(1);
  });

  it("leaves the catalog, scopes, and counts, lets a survey in progress finish, and keeps its history", () => {
    const boundary = new SourceBoundary(getConfig());
    const orders = registerSource(db, { name: "orders", cloneUrl: "https://git.example.com/acme/orders.git", gitRef: "" }, boundary);
    const survey = surveyQueued(orders);
    const billing = buildSource(db, { name: "billing" });
    const checkout = buildAssessment(db, { name: "Checkout", sources: [orders, billing] });
    const { run } = buildRun(db, { sources: [orders, billing] });

    deleteSource(db, orders.publicId, " orders ");

    expect(findSource(db, orders.publicId)).toBeUndefined();
    expect(findSourceIncludingDeleted(db, orders.publicId)?.deletedAt).toBeInstanceOf(Date);
    expect(listSources(db).map((source) => source.name)).toEqual(["billing"]);
    expect(fleetSummary(db).repositories).toMatchObject({ total: 1 });
    expect(resolveScope(db, buildAssessment(db)).map((source) => source.name)).toEqual(["billing"]);
    expect(selectedSources(db, checkout.id).map((source) => source.name)).toEqual(["billing"]);
    expect(versionsOf(db, orders.id).map((version) => version.survey)).toEqual([survey]);
    expect(db.$client.prepare("select source_name from assessment_targets where assessment_id = ? order by source_name").all(run.id)).toEqual([{ source_name: "billing" }, { source_name: "orders" }]);
  });

  it("frees its clone URL for a new Repository, and stays deleted", () => {
    const boundary = new SourceBoundary(getConfig());
    const form = { name: "orders", cloneUrl: "https://git.example.com/acme/orders.git", gitRef: "" };
    const first = registerSource(db, form, boundary);
    deleteSource(db, first.publicId, "orders");

    const second = registerSource(db, form, boundary);
    expect(second.publicId).not.toBe(first.publicId);
    expect(() => rawRun(db, "update repository_sources set deleted_at = null where id = ?", first.id)).toThrow(/stays deleted/);
    expect(() => deleteSource(db, first.publicId, "orders")).toThrow(/does not exist/);
  });
});
