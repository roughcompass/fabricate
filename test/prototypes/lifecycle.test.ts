import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getConfig, loadConfig, setConfig, withOverrides } from "@/lib/config";
import { newWorkspaceKey } from "@/lib/demo/workspace-key";
import { type PrototypesConnection, setPrototypesDb } from "@/lib/prototypes/db/client";
import { lessons, personas, prototypes, shares, templateVersions, templates, variants, versions, workspaces } from "@/lib/prototypes/db/schema";
import { startGeneration } from "@/lib/prototypes/pipeline/start";
import { createShare, sharedVersion } from "@/lib/prototypes/shares";
import { acceptVersion, liveTemplates } from "@/lib/prototypes/templates";
import { keepVariant } from "@/lib/prototypes/variants";
import { ensurePrototypesWorkspace, purgeIdlePrototypesWorkspaces, resetPrototypesWorkspace } from "@/lib/prototypes/workspace";
import { orchestrateGeneration } from "@/workflows/prototypes/orchestrate";
import { createPrototypesTestDb } from "../support/prototypes-db";

// prototypes/availability spec: "Visitors can reset their Prototypes workspace"
// and "Workspace data is bounded" (idle workspaces are deleted).

describe("workspace lifecycle", () => {
  let connection: PrototypesConnection;
  const original = getConfig();
  const DAY = 24 * 60 * 60 * 1000;

  beforeEach(async () => {
    setConfig(withOverrides(loadConfig({ environment: "test" }), { prototypes: { models: { generate: "mock", plan: "mock", review: "mock", learn: "mock" } } }));
    connection = await createPrototypesTestDb();
    await setPrototypesDb(connection);
  });

  afterEach(async () => {
    await setPrototypesDb(undefined);
    setConfig(original);
  });

  /** A workspace with a kept, accepted, shared page prototype and a lesson. Returns its id, the share token, and the template's id. */
  async function busy(now = new Date()) {
    const workspaceId = (await ensurePrototypesWorkspace(connection.db, newWorkspaceKey(), now)).id;
    const [approver] = await connection.db.select().from(personas).where(eq(personas.workspaceId, workspaceId)).orderBy(personas.createdAt);
    const generationId = await startGeneration(connection.db, workspaceId, { intent: "Review and release today's urgent payments before cut-off", scope: "page", personaIds: [approver!.id], variants: 1 });
    await orchestrateGeneration(generationId);
    const [variant] = await connection.db.select().from(variants).where(eq(variants.generationId, generationId));
    const { prototypeId } = await keepVariant(connection.db, workspaceId, variant!.id, "");
    await connection.db.update(versions).set({ audit: { violations: [], at: now.toISOString() } }).where(eq(versions.prototypeId, prototypeId));
    const { template } = await acceptVersion(connection.db, workspaceId, variant!.versionId!, { title: "Urgent payments queue", description: "Payments that need action lead.", brand: "payments", tags: ["Payments"], displayName: null }, null, now);
    const token = await createShare(connection.db, workspaceId, variant!.versionId!, now);
    await connection.db.insert(lessons).values({ id: "lsn_aaaaaaaaaaaaaaaa", workspaceId, text: "Lead with the exceptions.", scope: { kind: "general" }, category: "Content", status: "active", source: "visitor", citations: [] });
    await connection.db.update(personas).set({ name: "Edited" }).where(eq(personas.id, approver!.id));
    return { workspaceId, token, templateId: template.id };
  }

  it("restores the seeded content and keeps accepted templates, without refilling today's limit (Resetting)", async () => {
    const { workspaceId, token, templateId } = await busy();
    const [before] = await connection.db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
    await resetPrototypesWorkspace(connection.db, workspaceId);

    expect(await connection.db.select().from(prototypes).where(eq(prototypes.workspaceId, workspaceId))).toEqual([]);
    expect(await connection.db.select().from(lessons).where(eq(lessons.workspaceId, workspaceId))).toEqual([]);
    expect(await connection.db.select().from(shares)).toEqual([]);
    expect(await sharedVersion(connection.db, token)).toBeNull();
    const seeded = await connection.db.select().from(personas).where(eq(personas.workspaceId, workspaceId));
    expect(seeded.map((persona) => persona.name).sort()).toEqual(["Amara Haddad", "Daniel Okafor", "Maya Lindqvist", "Sofia Marchetti", "Wei Chen"]);

    const [after] = await connection.db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
    expect(after).toMatchObject({ id: workspaceId, credentialDigest: before!.credentialDigest, variantsToday: before!.variantsToday, prototypeCount: 0, personaCount: 5, lessonCount: 0 });
    const [template] = await liveTemplates(connection.db);
    expect(template).toMatchObject({ id: templateId, workspaceId, prototypeId: null });
  });

  it("deletes workspaces idle for 30 days with their data, keeping the templates they accepted", async () => {
    const start = new Date("2026-09-01T09:00:00.000Z");
    const idle = await busy(start);
    const active = (await ensurePrototypesWorkspace(connection.db, newWorkspaceKey(), new Date(start.getTime() + 20 * DAY))).id;

    expect(await purgeIdlePrototypesWorkspaces(connection.db, new Date(start.getTime() + 29 * DAY))).toBe(0);
    expect(await purgeIdlePrototypesWorkspaces(connection.db, new Date(start.getTime() + 31 * DAY))).toBe(1);

    expect((await connection.db.select().from(workspaces)).map((row) => row.id)).toEqual([active]);
    expect(await connection.db.select().from(prototypes).where(eq(prototypes.workspaceId, idle.workspaceId))).toEqual([]);
    expect(await sharedVersion(connection.db, idle.token)).toBeNull();
    const [template] = await connection.db.select().from(templates).where(eq(templates.id, idle.templateId));
    expect(template).toMatchObject({ workspaceId: null, withdrawnAt: null });
    const [version] = await connection.db.select().from(templateVersions).where(eq(templateVersions.templateId, idle.templateId));
    expect(version).toMatchObject({ workspaceId: null, acceptedBy: "Anonymous visitor" });
    expect(await liveTemplates(connection.db)).toHaveLength(1);
  });
});
