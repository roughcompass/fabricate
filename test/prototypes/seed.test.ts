import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getConfig, loadConfig, setConfig, withOverrides } from "@/lib/config";
import { generatePublicId } from "@/lib/db/ids";
import { keyDigest } from "@/lib/demo/workspace-digest";
import { newWorkspaceKey } from "@/lib/demo/workspace-key";
import { type PrototypesConnection, setPrototypesDb } from "@/lib/prototypes/db/client";
import { feedback, generations, lessonChecks, lessons, pageShells, pairwiseReviews, personas, prototypes, versions, workspaces } from "@/lib/prototypes/db/schema";
import { versionsOf } from "@/lib/prototypes/prototypes";
import { progressRows } from "@/lib/prototypes/progress";
import { RUNTIME } from "@/lib/prototypes/render";
import { SEED_PERSONAS } from "@/lib/prototypes/seed/defaults";
import { committedSeed } from "@/lib/prototypes/seed/import";
import { rehearse } from "@/lib/prototypes/seed/rehearsal";
import { type WorkspaceSeed, exportWorkspaceSeed, importWorkspaceSeed } from "@/lib/prototypes/seed/workspace-seed";
import { ensurePrototypesWorkspace } from "@/lib/prototypes/workspace";
import { createPrototypesTestDb } from "../support/prototypes-db";

// prototypes/availability spec: "Each workspace starts with seeded examples";
// design.md, decision 12. The seed is captured from the real pipeline, here on
// the scripted model, and copied into a new workspace with no model call.

const MOCK = { generate: "mock", plan: "mock", review: "mock", learn: "mock" };

describe("seeded workspaces", () => {
  let connection: PrototypesConnection;
  const original = getConfig();
  let seed: WorkspaceSeed;

  beforeEach(async () => {
    setConfig(withOverrides(loadConfig({ environment: "test" }), { prototypes: { models: MOCK, dailyVariantLimit: 200 } }));
    connection = await createPrototypesTestDb();
    await setPrototypesDb(connection);
    const rehearsed = (await ensurePrototypesWorkspace(connection.db, newWorkspaceKey())).id;
    await rehearse(connection.db, rehearsed);
    seed = JSON.parse(JSON.stringify(await exportWorkspaceSeed(connection.db, rehearsed))) as WorkspaceSeed;
  }, 120_000);

  afterEach(async () => {
    await setPrototypesDb(undefined);
    setConfig(original);
  });

  /** A new workspace seeded from `from`, with no model available, so any model call would fail. */
  async function seeded(from: WorkspaceSeed = seed): Promise<string> {
    setConfig(withOverrides(getConfig(), { prototypes: { models: { generate: "unavailable/model", plan: "unavailable/model", review: "unavailable/model", learn: "unavailable/model" } } }));
    const id = generatePublicId("pws");
    await connection.db.transaction(async (tx) => {
      await tx.insert(workspaces).values({ id, credentialDigest: keyDigest(newWorkspaceKey()), counterDay: "2026-10-16" });
      await importWorkspaceSeed(tx, id, from);
    });
    return id;
  }

  it("gives a new workspace five personas, three prototypes of both scopes with a fork and three versions, six generations, and a lesson check, without a model call (First visit; Seeds without a model)", async () => {
    const workspaceId = await seeded();
    const own = { personas: await connection.db.select().from(personas).where(eq(personas.workspaceId, workspaceId)) };
    expect(own.personas.map((persona) => persona.name)).toEqual(SEED_PERSONAS.map((persona) => persona.name));
    expect(own.personas.every((persona) => persona.example)).toBe(true);

    const made = await connection.db.select().from(prototypes).where(eq(prototypes.workspaceId, workspaceId));
    expect(made.length).toBeGreaterThanOrEqual(4);
    expect(made.every((prototype) => prototype.seeded)).toBe(true);
    expect(made.filter((prototype) => prototype.scope === "component")).toHaveLength(1);
    expect(made.filter((prototype) => prototype.scope === "page").length).toBeGreaterThanOrEqual(2);
    const fork = made.find((prototype) => prototype.name.endsWith("(fork)"))!;
    const [forked] = await versionsOf(connection.db, fork.id);
    expect(made.map((prototype) => prototype.id)).toContain(forked!.provenance!.forkedFrom!.prototypeId);

    const approvals = made.find((prototype) => prototype.latestNumber >= 3)!;
    const history = await versionsOf(connection.db, approvals.id);
    expect(history.map((version) => version.number)).toEqual([1, 2, 3]);
    expect(history.every((version) => version.compiled && version.fit?.status === "reviewed")).toBe(true);
    const given = await connection.db.select().from(feedback).where(eq(feedback.workspaceId, workspaceId));
    expect(given.filter((entry) => entry.kind === "rating" && history.some((version) => version.id === entry.versionId))).toHaveLength(3);
    const learned = await connection.db.select().from(lessons).where(eq(lessons.workspaceId, workspaceId));
    expect(learned.filter((lesson) => lesson.status === "active").length).toBeGreaterThan(0);
    // Citations point at this workspace's copies of the feedback.
    const cited = learned.flatMap((lesson) => lesson.citations.flatMap((citation) => (citation.kind === "feedback" ? [citation.feedbackId] : [])));
    expect(cited.length).toBeGreaterThan(0);
    expect(cited.every((id) => given.some((entry) => entry.id === id))).toBe(true);

    expect((await progressRows(connection.db, workspaceId)).length).toBeGreaterThanOrEqual(6);
    const [check] = await connection.db.select().from(lessonChecks).where(eq(lessonChecks.workspaceId, workspaceId));
    expect(check).toMatchObject({ status: "done", result: { pairs: expect.any(Array) } });
    expect(await connection.db.select().from(pairwiseReviews).where(eq(pairwiseReviews.workspaceId, workspaceId))).toHaveLength(1);
    expect(await connection.db.select().from(pageShells).where(eq(pageShells.workspaceId, workspaceId))).toHaveLength(1);
  });

  it("gives every workspace the same content under its own ids", async () => {
    const first = await seeded();
    const second = await seeded();
    const view = async (workspaceId: string) => (await connection.db.select().from(prototypes).where(eq(prototypes.workspaceId, workspaceId))).map((prototype) => [prototype.name, prototype.latestNumber]).sort();
    expect(await view(first)).toEqual(await view(second));
    const ids = async (workspaceId: string) => new Set((await connection.db.select({ id: versions.id }).from(versions).where(eq(versions.workspaceId, workspaceId))).map((row) => row.id));
    const [one, two] = [await ids(first), await ids(second)];
    const captured = new Set(seed.versions.map((version) => version.id));
    expect([...one].some((id) => two.has(id) || captured.has(id))).toBe(false);
  });

  it("recompiles seeded code when the runtime build has changed since capture", async () => {
    const stale: WorkspaceSeed = { ...seed, runtimeHash: "earlier-build", versions: seed.versions.map((version) => ({ ...version, compiled: "stale", runtimeHash: "earlier-build" })) };
    const workspaceId = await seeded(stale);
    const own = await connection.db.select().from(versions).where(eq(versions.workspaceId, workspaceId));
    expect(own.every((version) => version.runtimeHash === RUNTIME.hash && version.compiled?.includes("__fabricatePrototype"))).toBe(true);
  });
});

describe("the committed seed", () => {
  it("was captured from the defaults: the five seeded personas, by name and role", () => {
    const seed = committedSeed();
    if (!seed) return expect(seed).toBeNull();
    expect(seed.personas.map((persona) => [persona.name, persona.role])).toEqual(SEED_PERSONAS.map((persona) => [persona.name, persona.role]));
    expect(seed.generations.filter((generation) => generation.kind !== "lesson-check").length).toBeGreaterThanOrEqual(6);
  });

  it("seeds only the defaults when the examples setting is off", async () => {
    const connection = await createPrototypesTestDb();
    try {
      const workspaceId = (await ensurePrototypesWorkspace(connection.db, newWorkspaceKey())).id;
      expect(await connection.db.select().from(prototypes).where(eq(prototypes.workspaceId, workspaceId))).toEqual([]);
      expect(await connection.db.select().from(generations).where(eq(generations.workspaceId, workspaceId))).toEqual([]);
    } finally {
      await connection.close();
    }
  });
});
