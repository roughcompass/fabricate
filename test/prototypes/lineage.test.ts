import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getConfig, loadConfig, setConfig, withOverrides } from "@/lib/config";
import { newWorkspaceKey } from "@/lib/demo/workspace-key";
import { type PrototypesConnection, setPrototypesDb } from "@/lib/prototypes/db/client";
import { personas, variants, versions } from "@/lib/prototypes/db/schema";
import { forkVersion } from "@/lib/prototypes/fork";
import { portalAllowed } from "@/lib/prototypes/gates";
import { startRefinement } from "@/lib/prototypes/pipeline/refine";
import { startGeneration } from "@/lib/prototypes/pipeline/start";
import { versionsOf } from "@/lib/prototypes/prototypes";
import { keepVariant } from "@/lib/prototypes/variants";
import { ensurePrototypesWorkspace } from "@/lib/prototypes/workspace";
import { orchestrateGeneration } from "@/workflows/prototypes/orchestrate";
import { createPrototypesTestDb } from "../support/prototypes-db";

// converge-templates-and-prototypes, design decision 5: a hero lineage, through forks and refinements, may import @deweb/portal.

describe("hero lineage", () => {
  let connection: PrototypesConnection;
  let workspaceId: string;
  const original = getConfig();

  beforeEach(async () => {
    setConfig(withOverrides(loadConfig({ environment: "test" }), { prototypes: { models: { generate: "mock", plan: "mock", review: "mock", learn: "mock" } } }));
    connection = await createPrototypesTestDb();
    await setPrototypesDb(connection);
    workspaceId = (await ensurePrototypesWorkspace(connection.db, newWorkspaceKey())).id;
  });

  afterEach(async () => {
    await setPrototypesDb(undefined);
    setConfig(original);
  });

  /** A kept page at version 1, its provenance naming +hero+ as where its lineage starts. */
  async function kept(hero: string | null): Promise<{ prototypeId: string; versionId: string }> {
    const [approver] = await connection.db.select().from(personas).where(eq(personas.workspaceId, workspaceId)).orderBy(personas.createdAt);
    const generationId = await startGeneration(connection.db, workspaceId, { intent: "Review and release today's urgent payments before cut-off", scope: "page", personaIds: [approver!.id], variants: 1 });
    await orchestrateGeneration(generationId);
    const [variant] = await connection.db.select().from(variants).where(eq(variants.generationId, generationId));
    const { prototypeId } = await keepVariant(connection.db, workspaceId, variant!.id, "");
    const [version] = await connection.db.select().from(versions).where(eq(versions.id, variant!.versionId!));
    await connection.db.update(versions).set({ provenance: { ...version!.provenance!, hero } }).where(eq(versions.id, version!.id));
    return { prototypeId, versionId: version!.id };
  }

  async function refine(prototypeId: string, baseVersionId: string) {
    await orchestrateGeneration(await startRefinement(connection.db, workspaceId, prototypeId, baseVersionId, "Group by cut-off time"));
    return (await versionsOf(connection.db, prototypeId)).at(-1)!;
  }

  it("keeps a hero through a fork and a refinement of the fork, so the refinement may import @deweb/portal", async () => {
    const { versionId } = await kept("payments-workspace");
    const forkId = await forkVersion(connection.db, workspaceId, versionId);
    const [fork] = await versionsOf(connection.db, forkId);
    expect(fork!.provenance?.hero).toBe("payments-workspace");

    const refined = await refine(forkId, fork!.id);
    expect(refined).toMatchObject({ number: 2, status: "ready" });
    expect(refined.provenance?.hero).toBe("payments-workspace");
    expect(portalAllowed(refined.provenance)).toBe(true);
  });

  it("gives every other lineage no hero, so it may not import @deweb/portal", async () => {
    const { prototypeId, versionId } = await kept(null);
    const refined = await refine(prototypeId, versionId);
    expect(refined.provenance?.hero).toBeNull();
    expect(portalAllowed(refined.provenance)).toBe(false);
  });
});
