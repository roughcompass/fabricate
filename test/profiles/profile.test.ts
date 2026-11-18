import { DETECTOR_RELEASE } from "@repo-facts/bundle";
import { type JsonObject, digestOf, dump } from "@repo-facts/contract";
import { afterEach, describe, expect, it } from "vitest";
import { transitionTarget } from "@/lib/assessments/transitions";
import { withOverrides } from "@/lib/config";
import { ValidationError } from "@/lib/db/errors";
import { AnalysisMismatchError, analyzeSnapshot } from "@/lib/profiles/analyze";
import { type RepositoryProfile, insertProfile, profileDocument, profilesOf } from "@/lib/profiles/profile-records";
import { PROFILE_SCHEMA, buildProfile, profileProblems } from "@/lib/profiles/schema";
import { asProfileVersion1 } from "../support/scenarios";
import { type FileTree, SnapshotFixture } from "../support/snapshot";

const APP: FileTree = {
  "package.json": '{\n  "name": "orders-ui",\n  "version": "1.2.0",\n  "packageManager": "pnpm@9.1.0",\n  "engines": { "node": ">=20" }\n}\n',
  ".nvmrc": "18\n",
  "src/client.ts": 'export const load = () => fetch("https://api.example.test/orders", { headers: { Authorization: `Bearer ${process.env.ORDERS_TOKEN}` } });\n',
};

describe("Repository Profiles from the pinned repo-facts bundle", () => {
  let snapshots: SnapshotFixture;
  afterEach(() => snapshots.cleanup());

  /** Commits +files+, acquires them, and analyzes the snapshot like the worker does. */
  async function analyzed(files: FileTree, overrides: Parameters<typeof SnapshotFixture.create>[1] = {}) {
    snapshots ??= SnapshotFixture.create("profile", overrides);
    const acquired = await snapshots.acquireFiles(files);
    return analyzeAcquired(acquired);
  }

  async function analyzeAcquired(acquired: Awaited<ReturnType<SnapshotFixture["acquireCommitted"]>>) {
    const target = transitionTarget(snapshots.db, acquired.target, "analyzing");
    const profile = await analyzeSnapshot(snapshots.db, { assessment: acquired.assessment, target, snapshot: acquired.snapshot, config: snapshots.config });
    return { ...acquired, target, profile, document: profileDocument(profile) as Record<string, JsonObject> & JsonObject };
  }

  const factDocument = (document: JsonObject) => document.fact_document as Record<string, Record<string, JsonObject>>;

  it("wraps the unchanged fact document in an envelope that records the source, commit, release, and configuration", async () => {
    snapshots = SnapshotFixture.create("profile");
    const { assessment, target, snapshot, profile, document } = await analyzed(APP);

    expect(document).toMatchObject({
      schema: PROFILE_SCHEMA,
      schema_version: 2,
      source: { public_id: target.sourcePublicId, name: "app", clone_url: target.cloneUrl, git_ref: null },
      commit: snapshot.commitSha,
      detector_release: DETECTOR_RELEASE,
      detector_configuration_digest: assessment.configurationDigest,
    });
    // Profile version 2 embeds fact document version 2, with the design-system categories.
    expect(document.fact_document).toMatchObject({ schema: "repo_facts.fact_document", schema_version: 2, commit: snapshot.commitSha, detector_release: DETECTOR_RELEASE });
    expect(Object.keys(factDocument(document).categories!)).toEqual(expect.arrayContaining(["design_systems", "ui_elements", "style_values"]));
    expect(document.fact_document_digest).toBe(digestOf(document.fact_document).digest);
    expect(profileProblems(document)).toEqual([]);
    expect(profile).toMatchObject({ detectorRelease: DETECTOR_RELEASE, schemaVersion: 2, sourceSnapshotId: snapshot.id, assessmentTargetId: target.id });
    // Run identity and times stay on the record, so they cannot change the document.
    expect(dump(document)).not.toContain(assessment.publicId);
  });

  it("stores identical Profile documents and digests for identical snapshots", async () => {
    snapshots = SnapshotFixture.create("profile");
    const first = await analyzed(APP);
    const second = await analyzeAcquired(await snapshots.acquireCommitted());

    expect(second.assessment.id).not.toBe(first.assessment.id);
    expect(second.snapshot.commitSha).toBe(first.snapshot.commitSha);
    expect(second.profile.digest).toBe(first.profile.digest);
    expect(second.profile.document).toBe(first.profile.document);
    // The embedded fact documents are byte-identical too.
    expect(dump(second.document.fact_document)).toBe(dump(first.document.fact_document));
  });

  it("keeps conflicting declarations with all their evidence", async () => {
    snapshots = SnapshotFixture.create("profile");
    const { document } = await analyzed(APP);
    const runtime = factDocument(document).categories!.runtime_requirements as unknown as { state: string; facts: { key: string; state: string; candidates?: { evidence: string[] }[] }[] };

    const node = runtime.facts.find((fact) => fact.key === "node");
    expect(node?.state).toBe("conflicting");
    expect(node?.candidates).toHaveLength(2);
    for (const candidate of node!.candidates!) expect(candidate.evidence.length).toBeGreaterThan(0);
    expect(runtime.state).toBe("conflicting");
  });

  it("reports categories whose inputs were skipped as unknown, not absent", async () => {
    snapshots = SnapshotFixture.create("profile", { analysis: { maxBlobBytes: 64, maxLockfileBytes: 64 } });
    const { document } = await analyzed({ ...APP, "package-lock.json": `{ "lockfileVersion": 3, "packages": { "": { "name": "orders-ui" } }, "padding": "${"x".repeat(200)}" }\n` });
    const facts = factDocument(document);

    expect(facts.categories!.resolved_dependencies).toMatchObject({ state: "unknown" });
    expect((facts.categories!.resolved_dependencies as JsonObject).search).toMatchObject({ skipped: expect.arrayContaining(["package-lock.json"]) });
    expect(facts.diagnostics).toContainEqual(expect.objectContaining({ path: "package-lock.json", reason: "blob_too_large" }));
  });

  it("records Service Dependencies statically, with access always unknown and no credential value", async () => {
    snapshots = SnapshotFixture.create("profile");
    const { document } = await analyzed(APP);
    const services = factDocument(document).service_dependencies as unknown as { key: string; access: JsonObject; authentication: JsonObject }[];

    const orders = services.find((service) => service.key === "https://api.example.test");
    expect(orders?.access).toMatchObject({ state: "unknown" });
    expect(orders?.authentication).toMatchObject({ state: "observed", value: [{ header: "Authorization", value_source: { kind: "template", configured: [{ source: "process.env", key: "ORDERS_TOKEN" }] } }] });
    for (const service of services) expect(service.access.state).toBe("unknown");
  });

  it("rejects a Profile that asserts a fact without evidence, and stores nothing", async () => {
    snapshots = SnapshotFixture.create("profile");
    const acquired = await snapshots.acquireFiles(APP);
    const target = transitionTarget(snapshots.db, acquired.target, "analyzing");
    const reference = await analyzeAcquired(await snapshots.acquireCommitted());

    // An unsupported assertion: an observed fact stripped of its evidence, with the digests made consistent again.
    const tampered = JSON.parse(reference.profile.document) as { fact_document: { categories: Record<string, { facts: { state: string; evidence: string[] }[] }> } };
    const fact = Object.values(tampered.fact_document.categories).flatMap((category) => category.facts).find((item) => item.state === "observed")!;
    fact.evidence = [];
    const document = buildProfile({
      source: reference.document.source as never,
      commit: acquired.snapshot.commitSha,
      detectorRelease: DETECTOR_RELEASE,
      configurationDigest: acquired.assessment.configurationDigest,
      factDocument: tampered.fact_document as never,
    });

    expect(profileProblems(document)).toContainEqual(expect.stringMatching(/fact_document: .*without evidence/));
    expect(() => insertProfile(snapshots.db, { assessment: acquired.assessment, target, snapshot: acquired.snapshot, document, validate: profileProblems })).toThrow(ValidationError);
    expect(profilesOf(snapshots.db, acquired.assessment.id)).toEqual([]);
  });

  it("keeps reading a stored version 1 Profile, from detector release 0.1.0, unchanged", async () => {
    snapshots = SnapshotFixture.create("profile");
    const acquired = await snapshots.acquireFiles(APP);
    const target = transitionTarget(snapshots.db, acquired.target, "analyzing");
    const reference = await analyzeAcquired(await snapshots.acquireCommitted());

    // What 0.1.0 stored: fact document version 1, without the design-system categories, in a version 1 envelope.
    const document = asProfileVersion1(JSON.parse(reference.profile.document) as JsonObject);

    // A historical Profile is stored as it was written; nothing re-validates it against the newer contract.
    const stored = insertProfile(snapshots.db, { assessment: acquired.assessment, target, snapshot: acquired.snapshot, document });
    expect(stored.schemaVersion).toBe(1);
    expect(profileDocument(stored)).toEqual(document);
    expect((profileDocument(stored).fact_document as JsonObject).schema_version).toBe(1);
  });

  it("rejects an envelope whose embedded fact document does not match its digest, commit, or release", async () => {
    snapshots = SnapshotFixture.create("profile");
    const { document } = await analyzed(APP);

    expect(profileProblems({ ...document, fact_document_digest: "0".repeat(64) })).toEqual(["fact_document_digest does not match the embedded fact document"]);
    expect(profileProblems({ ...document, commit: "1".repeat(40) })).toEqual(["The fact document must describe the Profile's commit"]);
    expect(profileProblems({ ...document, detector_release: "9.9.9" })).toEqual(["The fact document must record the Profile's detector release"]);
    expect(profileProblems({ ...document, extra: true })).toEqual([expect.stringContaining("extra")]);
  });

  it("stores one Profile per snapshot, returning it again on a rerun", async () => {
    snapshots = SnapshotFixture.create("profile");
    const first = await analyzed(APP);
    const again: RepositoryProfile = await analyzeSnapshot(snapshots.db, { assessment: first.assessment, target: first.target, snapshot: first.snapshot, config: snapshots.config });

    expect(again.id).toBe(first.profile.id);
    expect(profilesOf(snapshots.db, first.assessment.id)).toHaveLength(1);
  });

  it("refuses to analyze with a detector release or configuration other than the one the Assessment recorded", async () => {
    snapshots = SnapshotFixture.create("profile");
    const acquired = await snapshots.acquireFiles(APP);
    const target = transitionTarget(snapshots.db, acquired.target, "analyzing");
    const analyzeFor = (assessment: typeof acquired.assessment) => analyzeSnapshot(snapshots.db, { assessment, target, snapshot: acquired.snapshot, config: snapshots.config });

    await expect(analyzeFor({ ...acquired.assessment, detectorRelease: "0.0.9" })).rejects.toThrow(AnalysisMismatchError);
    // A worker whose analysis limits differ from the launcher's produces a different configuration digest.
    await expect(analyzeSnapshot(snapshots.db, { assessment: acquired.assessment, target, snapshot: acquired.snapshot, config: withOverrides(snapshots.config, { analysis: { maxFiles: 7 } }) })).rejects.toThrow(
      AnalysisMismatchError,
    );
    expect(profilesOf(snapshots.db, acquired.assessment.id)).toEqual([]);
  });
});
