import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Assessment } from "@/lib/assessments/assessment-records";
import type { Db } from "@/lib/db/client";
import { profileDocument, profilesOf } from "@/lib/profiles/profile-records";
import { edgesOfNode, evidenceLocation, missingTargets, repositoriesResolving } from "@/lib/projection/queries";
import { mapOf } from "@/lib/relationships/map-records";
import { buildInitiative, buildSource } from "../support/builders";
import { createTestDb } from "../support/db";
import { pinnedRepository } from "../support/projection";
import { seedAssessment } from "../support/scenarios";

// Every stored document is read through readDocument; once +forbid+ is set, a read fails the test.
const guard = vi.hoisted(() => ({ forbid: false }));
vi.mock("@/lib/documents/digested", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/documents/digested")>();
  return {
    ...actual,
    readDocument: (...args: Parameters<typeof actual.readDocument>) => {
      if (guard.forbid) throw new Error(`A stored document was read: ${args[2]}`);
      return actual.readDocument(...args);
    },
  };
});

describe("projection queries", () => {
  let db: Db;
  let assessment: Assessment;

  beforeEach(async () => {
    guard.forbid = false;
    db = createTestDb();
    const sources = [buildSource(db, { name: "web" }), buildSource(db, { name: "client" }), buildSource(db, { name: "admin" }), buildSource(db, { name: "billing" })];
    assessment = await seedAssessment(db, buildInitiative(db, { sources }), sources, [
      pinnedRepository("web", { "@acme/client": "1.0.0", react: "16.14.0" }),
      pinnedRepository("@acme/client", { react: "18.3.1" }),
      pinnedRepository("admin", { react: "16.8.6" }),
      "failed",
    ]);
  });

  it("finds an evidence location without parsing its Profile (Evidence from a large Profile)", () => {
    const { profile, target } = profilesOf(db, assessment.id).find((row) => row.target.sourceName === "web")!;
    const evidence = (profileDocument(profile).fact_document as { evidence: Record<string, { path: string; location: unknown; detector: string; rule: string }> }).evidence;
    const [evidenceId, record] = Object.entries(evidence)[0]!;
    guard.forbid = true;

    expect(evidenceLocation(db, assessment.id, evidenceId)).toMatchObject({ evidenceId, profile: profile.publicId, target: target.publicId, path: record.path, location: record.location, detector: record.detector, rule: record.rule });
    expect(evidenceLocation(db, assessment.id, "ev_000000000000000000000000")).toBeUndefined();
  });

  it("answers which repositories resolve React 16 from dependency facts (Package version query)", () => {
    guard.forbid = true;

    const { repositories, missing } = repositoriesResolving(db, assessment.id, "react", "16.x");

    expect(repositories.map((row) => [row.source, row.resolvedVersion])).toEqual([
      ["web", "16.14.0"],
      ["admin", "16.8.6"],
    ]);
    expect(missing).toEqual([{ target: expect.stringMatching(/^tgt_/), source: "billing", state: "failed", reason: expect.any(String) }]);
    expect(repositoriesResolving(db, assessment.id, "react").repositories.map((row) => row.source)).toEqual(["web", "client", "admin"]);
  });

  it("reports a failed target as missing, not as a repository without the package (Failed target)", () => {
    guard.forbid = true;

    const { repositories, missing } = repositoriesResolving(db, assessment.id, "@acme/client");

    expect(repositories.map((row) => row.source)).toEqual(["web"]);
    expect(missing.map((target) => target.source)).toEqual(["billing"]);
    expect(missingTargets(db, assessment.id)).toEqual(missing);
  });

  it("lists a repository's edges by direction, type, and resolution state", () => {
    const map = mapOf(db, assessment.id)!;
    const nodes = db.$client.prepare("select node_id, label from graph_nodes where map_id = ? and kind = 'repository'").all(map.id) as { node_id: string; label: string }[];
    const web = nodes.find((node) => node.label === "web")!.node_id;
    const client = nodes.find((node) => node.label === "client")!.node_id;
    guard.forbid = true;

    const outgoing = edgesOfNode(db, map.id, web, { direction: "outgoing", types: ["package_dependency"], states: ["resolved"] });
    expect(outgoing).toEqual([expect.objectContaining({ type: "package_dependency", state: "resolved", from: web, to: client, rule: "package.exact-name", evidence: expect.arrayContaining([expect.stringMatching(/^ev_/)]) })]);
    expect(edgesOfNode(db, map.id, client, { direction: "incoming" }).map((edge) => edge.from)).toEqual([web]);
    expect(edgesOfNode(db, map.id, web, { states: ["unresolved"] }).map((edge) => edge.state)).toEqual(["unresolved"]);
  });
});
