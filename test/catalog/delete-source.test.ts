import { beforeEach, describe, expect, it } from "vitest";
import { resolveScope } from "@/lib/assessments/scope-resolver";
import { deleteSource, deletionEffects, registerSource } from "@/lib/catalog/catalog";
import { findSource, findSourceIncludingDeleted, listSources } from "@/lib/catalog/source-records";
import { SourceBoundary } from "@/lib/catalog/source-boundary";
import { getConfig } from "@/lib/config";
import type { Db } from "@/lib/db/client";
import { ValidationError } from "@/lib/db/errors";
import { claimInitiative, getInitiative, selectedSources } from "@/lib/initiatives/initiative-records";
import { repositoryCounts } from "@/lib/ownership/coverage";
import { versionsOf } from "@/lib/profiling/versions";
import { buildAssessment, buildInitiative, buildSource } from "../support/builders";
import { createTestDb, rawRun } from "../support/db";

describe("deleting a Repository", () => {
  let db: Db;
  beforeEach(() => {
    db = createTestDb();
  });

  it("refuses anything but its exact name as confirmation, and changes nothing", () => {
    const orders = buildSource(db, { name: "orders" });
    for (const typed of ["", "order", "Orders", "orders2"]) expect(() => deleteSource(db, orders.publicId, typed)).toThrow(ValidationError);
    expect(findSource(db, orders.publicId)).toBeDefined();
  });

  it("states what deleting changes: its versions, the Assessments that select it, and the Runs that keep its results", () => {
    const boundary = new SourceBoundary(getConfig());
    const orders = registerSource(db, { name: "orders", cloneUrl: "https://git.example.com/acme/orders.git", gitRef: "" }, boundary);
    buildInitiative(db, { name: "Checkout", sources: [orders] });
    buildAssessment(db, { sources: [orders] });

    expect(deletionEffects(db, orders)).toEqual({ versions: 1, assessments: ["Checkout"], runs: 1 });
  });

  it("leaves the catalog, scopes, and counts, cancels a version in progress, and keeps its history", () => {
    const boundary = new SourceBoundary(getConfig());
    const orders = registerSource(db, { name: "orders", cloneUrl: "https://git.example.com/acme/orders.git", gitRef: "" }, boundary);
    const billing = buildSource(db, { name: "billing" });
    const checkout = buildInitiative(db, { name: "Checkout", sources: [orders, billing] });
    const claimed = claimInitiative(db, orders);
    const { assessment } = buildAssessment(db, { sources: [orders, billing] });

    deleteSource(db, orders.publicId, " orders ");

    expect(findSource(db, orders.publicId)).toBeUndefined();
    expect(findSourceIncludingDeleted(db, orders.publicId)?.deletedAt).toBeInstanceOf(Date);
    expect(listSources(db).map((source) => source.name)).toEqual(["billing"]);
    expect(repositoryCounts(db)).toMatchObject({ total: 1 });
    expect(resolveScope(db, buildInitiative(db)).map((source) => source.name)).toEqual(["billing"]);
    expect(selectedSources(db, checkout.id).map((source) => source.name)).toEqual(["billing"]);
    // The Assessment created for its claim keeps its one repository, which can no longer be assessed.
    expect(() => resolveScope(db, getInitiative(db, claimed.publicId))).toThrow(/orders .* was deleted/);
    expect(versionsOf(db, orders.id)[0]!.assessment.cancelRequestedAt).toBeInstanceOf(Date);
    expect(db.$client.prepare("select source_name from assessment_targets where assessment_id = ? order by source_name").all(assessment.id)).toEqual([{ source_name: "billing" }, { source_name: "orders" }]);
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
