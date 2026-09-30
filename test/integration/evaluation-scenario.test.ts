import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { JsonObject } from "@repo-facts/contract";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { type Assessment, getAssessment } from "@/lib/assessments/assessment-records";
import { launchAssessment } from "@/lib/assessments/launcher";
import type { FabricateConfig } from "@/lib/config";
import type { Db } from "@/lib/db/client";
import { type Evaluation, evaluationReleasesOf, findingDocument, findingsOf, getEvaluation } from "@/lib/evaluations/evaluation-records";
import { startEvaluation } from "@/lib/evaluations/start";
import { GitRunner } from "@/lib/git/runner";
import { type Initiative, getInitiative } from "@/lib/initiatives/initiative-records";
import { jobHandlers } from "@/lib/jobs/registry";
import { drainJobs } from "@/lib/jobs/worker";
import { SnapshotReader } from "@/lib/snapshot/reader";
import { publishDraft, reviseRelease } from "@/lib/standards/publish";
import { type StandardRelease, saveDraft } from "@/lib/standards/standard-records";
import { acquisitionConfig, registerLocalSource } from "../support/acquisition";
import { buildInitiative } from "../support/builders";
import { createTestDb } from "../support/db";
import { GitFixture } from "../support/git-fixture";
import { manifest } from "../support/profiles";
import { publishStandard, selectReleases } from "../support/scenarios";
import { NO_NETWORK_CALLS, countNetworkCalls } from "../support/traps";

/**
 * Evaluations of one real, acquired Assessment with partial coverage:
 * repository, Service Dependency, and relationship Controls in independent
 * Releases produce every outcome; a rerun reproduces the result exactly; and
 * the Assessment is reused after the desired state changes. Git, snapshot
 * readers, and the network are trapped throughout, and for the reruns the
 * mirrors and sources are deleted, so any attempt to re-read a repository
 * would fail the Evaluation.
 */

const control = (fields: JsonObject): JsonObject => ({ severity: "medium", subject: "repository", applicability: { op: "always" }, guidance: null, ...fields });

const REPOSITORY = [
  control({ key: "no-submodules", title: "Declares no submodules", rationale: "Reproducible checkouts.", condition: { op: "compare", selector: "repository.submodule_count", comparator: "eq", value: 0 } }),
  control({ key: "node-declared", title: "Declares a Node.js requirement", rationale: "Builds need a known runtime.", condition: { op: "exists", selector: "repository.node_range" } }),
  control({ key: "react-18", title: "Declares React 18 or newer", rationale: "Shared components need React 18.", applicability: { op: "exists", selector: "repository.declared_range", parameter: "react" }, condition: { op: "semver_satisfies", selector: "repository.declared_range", parameter: "react", range: ">=18.0.0" } }),
];
const SERVICES = [
  control({
    key: "services-configurable",
    title: "Service destinations are configurable",
    rationale: "Tests point services at substitutes.",
    severity: "critical",
    applicability: { op: "some", collection: "service_dependencies", condition: { op: "always" } },
    condition: { op: "every", collection: "service_dependencies", condition: { op: "in", selector: "service.endpoint_derivation", values: ["configured", "host_provided"] } },
  }),
];
const RELATIONSHIPS = [
  control({ key: "full-coverage", title: "Every repository was assessed", rationale: "Relationships from a missing repository are unknown.", subject: "relationship_map", condition: { op: "equals", selector: "map.coverage_complete", value: true } }),
  control({
    key: "packages-resolve",
    title: "Every package dependency resolves",
    rationale: "Consumers must reach their producers.",
    subject: "relationship_map",
    condition: { op: "count", collection: "edges", where: { op: "all", items: [{ op: "equals", selector: "edge.type", value: "package_dependency" }, { op: "in", selector: "edge.state", values: ["unresolved", "ambiguous"] }] }, comparator: "eq", value: 0 },
  }),
];

describe("Evaluation scenario", () => {
  let fixture: GitFixture;
  let config: FabricateConfig;
  let db: Db;
  let initiative: Initiative;
  let assessment: Assessment;
  let releases: { repository: StandardRelease; services: StandardRelease; relationships: StandardRelease };
  const trapped: Record<string, number>[] = [];

  /** Starts an Evaluation and runs it with Git, snapshot readers, and the network trapped. */
  async function evaluate(): Promise<Evaluation> {
    const git = vi.spyOn(GitRunner.prototype as unknown as { run: () => never }, "run");
    const reader = vi.spyOn(SnapshotReader, "open");
    let evaluation!: Evaluation;
    const network = await countNetworkCalls(async () => {
      evaluation = startEvaluation(db, initiative.publicId, assessment.publicId, crypto.randomUUID()).evaluation;
      await drainJobs(db, jobHandlers(db, config));
    });
    trapped.push({ ...network, git: git.mock.calls.length, reader: reader.mock.calls.length });
    git.mockRestore();
    reader.mockRestore();
    return getEvaluation(db, evaluation.publicId);
  }

  const outcomes = (evaluation: Evaluation) => {
    const positions = new Map(evaluationReleasesOf(db, evaluation.id).map((pinned) => [pinned.id, pinned.position]));
    return findingsOf(db, evaluation.id)
      .map((finding) => `${positions.get(finding.evaluationReleaseId)} ${finding.controlKey} ${String((findingDocument(finding).subject as JsonObject).name)} ${finding.outcome}`)
      .sort();
  };

  beforeAll(async () => {
    fixture = GitFixture.create("evaluation-scenario");
    config = acquisitionConfig(fixture);
    db = createTestDb();
    const trees: Record<string, Record<string, string>> = {
      web: {
        "package.json": manifest({ name: "web", version: "1.0.0", private: true, dependencies: { "@acme/ui": "^2.0.0" } }),
        "src/payments.ts": 'export const charge = () => fetch("https://payments.invalid/v1/charges", { method: "POST" }).then((res) => res.json()).then((body) => body.status);\n',
      },
      ui: { "package.json": manifest({ name: "@acme/ui", version: "2.0.0", engines: { node: ">=20" } }) },
      billing: { "package.json": manifest({ name: "billing", version: "1.0.0" }) },
    };
    const sources = Object.entries(trees).map(([name, files]) => {
      const work = fixture.repo(`fleet/${name}`);
      for (const [file, content] of Object.entries(files)) work.write(file, content);
      work.commit();
      return registerLocalSource(db, config, name, work.path);
    });
    fs.rmSync(path.join(fixture.root, "fleet/billing"), { recursive: true, force: true });
    initiative = buildInitiative(db, { sources });
    assessment = launchAssessment(db, initiative.publicId, crypto.randomUUID(), config).assessment;
    await drainJobs(db, jobHandlers(db, config));
    assessment = getAssessment(db, assessment.publicId);

    releases = {
      repository: publishStandard(db, "Repository baseline", REPOSITORY),
      services: publishStandard(db, "Service readiness", SERVICES),
      relationships: publishStandard(db, "Relationships", RELATIONSHIPS),
    };
    initiative = selectReleases(db, initiative, [releases.repository, releases.services, releases.relationships]);
  }, 120_000);

  afterAll(() => {
    fixture.cleanup();
    fs.rmSync(config.repositoryStorage, { recursive: true, force: true });
  });

  let first: Evaluation;

  it("evaluates a partially covered Assessment against independent Releases, producing every outcome", async () => {
    expect(assessment.state).toBe("complete_with_issues");
    first = await evaluate();
    expect(first.state).toBe("complete");
    // Releases are pinned in Standard name order: Relationships (0), Repository baseline (1), Service readiness (2).
    expect(outcomes(first)).toEqual(
      [
        "0 full-coverage Relationship Map gap",
        "0 packages-resolve Relationship Map indeterminate",
        "1 no-submodules web meets",
        "1 no-submodules ui meets",
        "1 no-submodules billing indeterminate",
        "1 node-declared web gap",
        "1 node-declared ui meets",
        "1 node-declared billing indeterminate",
        "1 react-18 web not_applicable",
        "1 react-18 ui not_applicable",
        "1 react-18 billing indeterminate",
        "2 services-configurable web gap",
        "2 services-configurable ui not_applicable",
        "2 services-configurable billing indeterminate",
      ].sort(),
    );
  });

  it("explains uncertainty from partial coverage in each Finding", () => {
    const byKey = (key: string, subject: string) => findingsOf(db, first.id, { controlKey: key }).map(findingDocument).find((document) => (document.subject as JsonObject).name === subject)!;
    expect(byKey("no-submodules", "billing").causes).toEqual([expect.objectContaining({ reason: expect.stringContaining("billing has no Profile") })]);
    expect(String((byKey("packages-resolve", "Relationship Map").causes as JsonObject[])[0]!.reason)).toContain("billing");
  });

  it("summarizes each Release on its own", () => {
    const summary = JSON.parse(first.summary!) as { releases: { standard: string; conclusion: string; counts: Record<string, number> }[]; coverage_gaps: number };
    expect(summary.releases.map((release) => [release.standard, release.conclusion])).toEqual([
      ["Relationships", "gaps"],
      ["Repository baseline", "gaps"],
      ["Service readiness", "gaps"],
    ]);
    expect(summary.releases[1]!.counts).toEqual({ gap: 1, indeterminate: 3, meets: 3, not_applicable: 2 });
    expect(summary.coverage_gaps).toBe(1);
  });

  it("reproduces the same result from the stored Assessment, even with every repository and mirror gone", async () => {
    fs.rmSync(path.join(fixture.root, "fleet"), { recursive: true, force: true });
    fs.rmSync(config.repositoryStorage, { recursive: true, force: true });
    const rerun = await evaluate();
    expect(rerun.state).toBe("complete");
    expect(rerun.resultDigest).toBe(first.resultDigest);
    expect(findingsOf(db, rerun.id).map((finding) => finding.digest)).toEqual(findingsOf(db, first.id).map((finding) => finding.digest));
  });

  it("reuses the Assessment after the desired state changes, leaving earlier Evaluations as they were", async () => {
    const before = { digest: getEvaluation(db, first.publicId).resultDigest, findings: findingsOf(db, first.id).map((finding) => finding.digest) };
    // Revise Service readiness to accept literal destinations too, and drop the relationship Release.
    const draft = reviseRelease(db, releases.services.publicId);
    const revised = saveDraft(db, draft, draft.lockVersion, {
      schema: "fabricate.standard",
      schema_version: 1,
      input_schemas: { repository_profile: [1], relationship_map: [1] },
      controls: [{ ...SERVICES[0]!, condition: { op: "every", collection: "service_dependencies", condition: { op: "in", selector: "service.endpoint_derivation", values: ["configured", "host_provided", "literal"] } } }],
    });
    const v2 = publishDraft(db, (await import("@/lib/standards/standard-records")).standardById(db, releases.services.standardId).publicId, revised.lockVersion);
    initiative = selectReleases(db, getInitiative(db, initiative.publicId), [releases.repository, v2]);

    const changed = await evaluate();
    expect(changed).toMatchObject({ state: "complete", assessmentId: assessment.id });
    expect(outcomes(changed).filter((line) => line.includes("services-configurable"))).toEqual(["1 services-configurable billing indeterminate", "1 services-configurable ui not_applicable", "1 services-configurable web meets"]);
    expect(outcomes(changed).some((line) => line.includes("full-coverage"))).toBe(false);
    expect({ digest: getEvaluation(db, first.publicId).resultDigest, findings: findingsOf(db, first.id).map((finding) => finding.digest) }).toEqual(before);
  });

  it("never used Git, a snapshot reader, a detector, or the network while evaluating", () => {
    expect(trapped).toHaveLength(3);
    for (const calls of trapped) expect(calls).toEqual({ ...NO_NETWORK_CALLS, git: 0, reader: 0 });
  });
});
