import { SURVEYOR_RELEASE } from "@/lib/surveys/surveyor-release";
import { type JsonObject, digestOf, dump } from "@repo-facts/contract";
import { afterEach, describe, expect, it } from "vitest";
import { sourceById } from "@/lib/catalog/source-records";
import { withOverrides } from "@/lib/config";
import { repositoryProfiles } from "@/lib/db/schema";
import { ValidationError } from "@/lib/db/errors";
import { AnalysisMismatchError, surveyDocument } from "@/lib/profiles/analyze";
import { insertProfile, profileDocument, profileOfSurvey } from "@/lib/profiles/profile-records";
import { PROFILE_SCHEMA, buildProfile, profileProblems } from "@/lib/profiles/schema";
import { type Survey, getSurvey } from "@/lib/surveys/records";
import { finishSurvey, runSurvey } from "@/lib/surveys/run";
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

  type Acquired = Awaited<ReturnType<SnapshotFixture["acquireCommitted"]>>;

  /** Runs Surveyor on +survey+'s pinned commit like the survey job does, and returns the Profile document. */
  const documentOf = (survey: Survey, config = snapshots.config) => surveyDocument({ survey, repository: sourceById(snapshots.db, survey.repositorySourceId), config });

  /** Commits +files+, pins them for a survey, and surveys them like the survey job does. */
  async function surveyed(files: FileTree) {
    return finish(await snapshots.acquireFiles(files));
  }

  /** Surveys a pinned survey and finishes it with its document, storing the Profile. */
  async function finish(acquired: Acquired) {
    const survey = finishSurvey(snapshots.db, acquired.survey, { document: await documentOf(acquired.survey) });
    const profile = profileOfSurvey(snapshots.db, survey.id)!;
    return { ...acquired, survey, repository: sourceById(snapshots.db, survey.repositorySourceId), profile, document: profileDocument(profile) as Record<string, JsonObject> & JsonObject };
  }

  const factDocument = (document: JsonObject) => document.fact_document as Record<string, Record<string, JsonObject>>;

  it("wraps the unchanged fact document in an envelope that records the source, commit, release, and configuration", async () => {
    snapshots = SnapshotFixture.create("profile");
    const { survey, repository, profile, document } = await surveyed(APP);

    expect(document).toMatchObject({
      schema: PROFILE_SCHEMA,
      schema_version: 2,
      source: { public_id: repository.publicId, name: "app", clone_url: repository.cloneUrl, git_ref: null },
      commit: survey.commitSha,
      detector_release: SURVEYOR_RELEASE,
      detector_configuration_digest: survey.configurationDigest,
    });
    // Profile version 2 embeds fact document version 2, with the design-system categories.
    expect(document.fact_document).toMatchObject({ schema: "repo_facts.fact_document", schema_version: 2, commit: survey.commitSha, detector_release: SURVEYOR_RELEASE });
    expect(Object.keys(factDocument(document).categories!)).toEqual(expect.arrayContaining(["design_systems", "ui_elements", "style_values"]));
    expect(document.fact_document_digest).toBe(digestOf(document.fact_document).digest);
    expect(profileProblems(document)).toEqual([]);
    expect(profile).toMatchObject({ surveyorRelease: SURVEYOR_RELEASE, schemaVersion: 2, surveyId: survey.id });
    expect(survey).toMatchObject({ state: "succeeded", failureCode: null });
    // Survey identity and times stay on the record, so they cannot change the document.
    expect(dump(document)).not.toContain(survey.publicId);
  });

  it("names the reference a survey of another reference resolved from", async () => {
    snapshots = SnapshotFixture.create("profile");
    const { survey } = await snapshots.acquireFiles(APP);

    const document = await documentOf({ ...survey, fromConfiguredReference: false, reference: "refs/heads/feature" });
    expect(document.source).toMatchObject({ git_ref: "refs/heads/feature" });
  });

  it("surveys a commit once per recipe, and Surveyor writes the same document for it every time", async () => {
    snapshots = SnapshotFixture.create("profile");
    const first = await surveyed(APP);
    const again = await snapshots.acquireCommitted();

    // A second request for the commit and recipe finds the survey that already succeeded.
    expect(again.survey).toMatchObject({ id: first.survey.id, state: "succeeded" });
    const repeated = await documentOf(again.survey);
    expect(dump(repeated)).toBe(first.profile.document);
    // The embedded fact documents are byte-identical too.
    expect(dump(repeated.fact_document!)).toBe(dump(first.document.fact_document));
  });

  it("keeps one Profile per survey: finishing it again or rerunning its job changes nothing", async () => {
    snapshots = SnapshotFixture.create("profile");
    const first = await surveyed(APP);

    expect(finishSurvey(snapshots.db, first.survey, { document: first.document })).toEqual(first.survey);
    expect(await runSurvey(snapshots.db, first.survey.publicId, { config: snapshots.config })).toEqual(first.survey);
    expect(() => insertProfile(snapshots.db, { survey: first.survey, document: first.document })).toThrow(/written by its running survey/);
    expect(snapshots.db.select().from(repositoryProfiles).all().map((profile) => profile.id)).toEqual([first.profile.id]);
  });

  it("keeps conflicting declarations with all their evidence", async () => {
    snapshots = SnapshotFixture.create("profile");
    const { document } = await surveyed(APP);
    const runtime = factDocument(document).categories!.runtime_requirements as unknown as { state: string; facts: { key: string; state: string; candidates?: { evidence: string[] }[] }[] };

    const node = runtime.facts.find((fact) => fact.key === "node");
    expect(node?.state).toBe("conflicting");
    expect(node?.candidates).toHaveLength(2);
    for (const candidate of node!.candidates!) expect(candidate.evidence.length).toBeGreaterThan(0);
    expect(runtime.state).toBe("conflicting");
  });

  it("reports categories whose inputs were skipped as unknown, not absent", async () => {
    snapshots = SnapshotFixture.create("profile", { analysis: { maxBlobBytes: 64, maxLockfileBytes: 64 } });
    const { document } = await surveyed({ ...APP, "package-lock.json": `{ "lockfileVersion": 3, "packages": { "": { "name": "orders-ui" } }, "padding": "${"x".repeat(200)}" }\n` });
    const facts = factDocument(document);

    expect(facts.categories!.resolved_dependencies).toMatchObject({ state: "unknown" });
    expect((facts.categories!.resolved_dependencies as JsonObject).search).toMatchObject({ skipped: expect.arrayContaining(["package-lock.json"]) });
    expect(facts.diagnostics).toContainEqual(expect.objectContaining({ path: "package-lock.json", reason: "blob_too_large" }));
  });

  it("records Service Dependencies statically, with access always unknown and no credential value", async () => {
    snapshots = SnapshotFixture.create("profile");
    const { document } = await surveyed(APP);
    const services = factDocument(document).service_dependencies as unknown as { key: string; access: JsonObject; authentication: JsonObject }[];

    const orders = services.find((service) => service.key === "https://api.example.test");
    expect(orders?.access).toMatchObject({ state: "unknown" });
    expect(orders?.authentication).toMatchObject({ state: "observed", value: [{ header: "Authorization", value_source: { kind: "template", configured: [{ source: "process.env", key: "ORDERS_TOKEN" }] } }] });
    for (const service of services) expect(service.access.state).toBe("unknown");
  });

  it("rejects a Profile that asserts a fact without evidence, and stores nothing", async () => {
    snapshots = SnapshotFixture.create("profile");
    const { survey } = await snapshots.acquireFiles(APP);
    const reference = await documentOf(survey);

    // An unsupported assertion: an observed fact stripped of its evidence, with the digests made consistent again.
    const tampered = structuredClone(reference) as unknown as { fact_document: { categories: Record<string, { facts: { state: string; evidence: string[] }[] }> } };
    const fact = Object.values(tampered.fact_document.categories).flatMap((category) => category.facts).find((item) => item.state === "observed")!;
    fact.evidence = [];
    const document = buildProfile({
      source: reference.source as never,
      commit: survey.commitSha,
      surveyorRelease: SURVEYOR_RELEASE,
      configurationDigest: survey.configurationDigest,
      factDocument: tampered.fact_document as never,
    });

    expect(profileProblems(document)).toContainEqual(expect.stringMatching(/fact_document: .*without evidence/));
    expect(() => insertProfile(snapshots.db, { survey, document, validate: profileProblems })).toThrow(ValidationError);
    expect(() => finishSurvey(snapshots.db, survey, { document })).toThrow(ValidationError);
    expect(profileOfSurvey(snapshots.db, survey.id)).toBeUndefined();
    expect(getSurvey(snapshots.db, survey.publicId).state).toBe("running");
  });

  it("keeps reading a stored version 1 Profile, from Surveyor release 0.1.0, unchanged", async () => {
    snapshots = SnapshotFixture.create("profile");
    const { survey } = await snapshots.acquireFiles(APP);

    // What 0.1.0 stored: fact document version 1, without the design-system categories, in a version 1 envelope.
    const document = asProfileVersion1(await documentOf(survey));

    // A historical Profile is stored as it was written; nothing re-validates it against the newer contract.
    const stored = insertProfile(snapshots.db, { survey, document });
    expect(stored.schemaVersion).toBe(1);
    expect(profileDocument(stored)).toEqual(document);
    expect((profileDocument(stored).fact_document as JsonObject).schema_version).toBe(1);
  });

  it("rejects an envelope whose embedded fact document does not match its digest, commit, or release", async () => {
    snapshots = SnapshotFixture.create("profile");
    const { document } = await surveyed(APP);

    expect(profileProblems({ ...document, fact_document_digest: "0".repeat(64) })).toEqual(["fact_document_digest does not match the embedded fact document"]);
    expect(profileProblems({ ...document, commit: "1".repeat(40) })).toEqual(["The fact document must describe the Profile's commit"]);
    expect(profileProblems({ ...document, detector_release: "9.9.9" })).toEqual(["The fact document must record the Profile's Surveyor release"]);
    expect(profileProblems({ ...document, extra: true })).toEqual([expect.stringContaining("extra")]);
  });

  it("refuses to survey with a Surveyor release or configuration other than the survey's, or without its pin", async () => {
    snapshots = SnapshotFixture.create("profile");
    const { survey } = await snapshots.acquireFiles(APP);

    await expect(documentOf({ ...survey, surveyorRelease: "0.0.9" })).rejects.toThrow(AnalysisMismatchError);
    // A worker whose analysis limits differ from the survey's produces a different configuration digest.
    await expect(documentOf(survey, withOverrides(snapshots.config, { analysis: { maxFiles: 7 } }))).rejects.toThrow(AnalysisMismatchError);
    await expect(documentOf({ ...survey, internalRef: null })).rejects.toThrow(/no pinned commit/);
    expect(profileOfSurvey(snapshots.db, survey.id)).toBeUndefined();
  });
});
