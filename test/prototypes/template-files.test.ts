import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getConfig, loadConfig, setConfig, withOverrides } from "@/lib/config";
import { newWorkspaceKey } from "@/lib/demo/workspace-key";
import { type PrototypesConnection, setPrototypesDb } from "@/lib/prototypes/db/client";
import { personas, variants, versions } from "@/lib/prototypes/db/schema";
import { projectFiles } from "@/lib/prototypes/export";
import { startGeneration } from "@/lib/prototypes/pipeline/start";
import { saveShell } from "@/lib/prototypes/shell";
import { DEFAULT_SHELL } from "@/lib/prototypes/seed/defaults";
import { exportedPrototypeVersion, templateTargetFiles } from "@/lib/prototypes/template-files";
import { acceptVersion } from "@/lib/prototypes/templates";
import { keepVariant } from "@/lib/prototypes/variants";
import { ensurePrototypesWorkspace } from "@/lib/prototypes/workspace";
import { treeObjectId } from "@/lib/snapshot/stored-files";
import { orchestrateGeneration } from "@/workflows/prototypes/orchestrate";
import { createPrototypesTestDb } from "../support/prototypes-db";

// template-conformance spec: "The exported project SHALL be the same files the version's download contains."

describe("template target files", () => {
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

  async function keptPage(): Promise<string> {
    const [approver] = await connection.db.select().from(personas).where(eq(personas.workspaceId, workspaceId)).orderBy(personas.createdAt);
    const generationId = await startGeneration(connection.db, workspaceId, { intent: "Review and release today's urgent payments before cut-off", scope: "page", personaIds: [approver!.id], variants: 1 });
    await orchestrateGeneration(generationId);
    const [variant] = await connection.db.select().from(variants).where(eq(variants.generationId, generationId));
    const { prototypeId } = await keepVariant(connection.db, workspaceId, variant!.id, "");
    await connection.db.update(versions).set({ audit: { violations: [], at: "2026-10-16T09:00:00.000Z" } }).where(eq(versions.prototypeId, prototypeId));
    return variant!.versionId!;
  }

  it("reads the download's files before acceptance, and the same files from the template version after it", async () => {
    const versionId = await keptPage();
    const download = projectFiles((await exportedPrototypeVersion(connection.db, versionId, workspaceId))!);

    const before = await templateTargetFiles({ templateVersionPublicId: null, prototypeVersionPublicId: versionId });
    expect(before).toEqual(download);

    const { version } = await acceptVersion(connection.db, workspaceId, versionId, { title: "Urgent payments queue", description: "Payments that need action lead.", brand: "payments", tags: ["Payments"], displayName: null }, null);
    const after = await templateTargetFiles({ templateVersionPublicId: version.id, prototypeVersionPublicId: versionId });
    expect(treeObjectId(after)).toBe(treeObjectId(download));

    // The template version keeps the shell it was accepted in; the workspace's later shell changes only its download.
    await saveShell(connection.db, workspaceId, { ...DEFAULT_SHELL, appName: "Renamed portal" });
    expect(treeObjectId(await templateTargetFiles({ templateVersionPublicId: version.id, prototypeVersionPublicId: versionId }))).toBe(treeObjectId(download));
    expect(treeObjectId(await templateTargetFiles({ templateVersionPublicId: null, prototypeVersionPublicId: versionId }))).not.toBe(treeObjectId(download));
  });

  it("refuses a version that no longer exists", async () => {
    await expect(templateTargetFiles({ templateVersionPublicId: "ptv_gone000000000000", prototypeVersionPublicId: "ver_gone000000000000" })).rejects.toThrow(/no longer exists/);
    await expect(templateTargetFiles({ templateVersionPublicId: null, prototypeVersionPublicId: "ver_gone000000000000" })).rejects.toThrow(/no longer exists/);
  });
});
