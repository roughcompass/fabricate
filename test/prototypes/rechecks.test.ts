import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getConfig, loadConfig, setConfig, withOverrides } from "@/lib/config";
import { newWorkspaceKey } from "@/lib/demo/workspace-key";
import { type PrototypesConnection, setPrototypesDb } from "@/lib/prototypes/db/client";
import { personas, templateRechecks, templateVersions, variants, versions } from "@/lib/prototypes/db/schema";
import { startGeneration } from "@/lib/prototypes/pipeline/start";
import { RECHECK_TIMEOUT_MS, claimRecheck, classifyRecheck, isStale, recheckStale, runRecheck } from "@/lib/prototypes/rechecks";
import { RUNTIME } from "@/lib/prototypes/render";
import { acceptVersion, liveTemplates } from "@/lib/prototypes/templates";
import type { GateResult } from "@/lib/prototypes/types";
import { keepVariant } from "@/lib/prototypes/variants";
import { ensurePrototypesWorkspace } from "@/lib/prototypes/workspace";
import { orchestrateGeneration } from "@/workflows/prototypes/orchestrate";
import { createPrototypesTestDb } from "../support/prototypes-db";

// prototypes/versions spec: "Accepted templates are re-checked after a Salt
// upgrade" and "Re-check results are classified and shown"; design.md, decision 17.

const gate = (name: GateResult["gate"], status: GateResult["status"], warnings: string[] = [], issues: string[] = []): GateResult => ({
  gate: name,
  status,
  issues: issues.map((message) => ({ code: "TS2322", message, symbol: "Button.color" })),
  warnings: warnings.map((message) => ({ code: "salt-usage/deprecated", message })),
  durationMs: 1,
});
const passing = (warnings: string[] = []) => [gate("typecheck", "passed"), gate("salt-only", "passed"), gate("salt-usage", "passed", warnings), gate("build", "passed")];

describe("template re-checks", () => {
  it("classifies a re-check against the results at acceptance (Salt deprecates an API; Salt removes a property; A warning goes away)", () => {
    expect(classifyRecheck(passing(["Tokenized input is in lab."]), passing(["Tokenized input is in lab."]))).toBe("unchanged");
    expect(classifyRecheck(passing(["Tokenized input is in lab."]), passing())).toBe("fixed");
    expect(classifyRecheck(passing(), passing(["Button's variant is deprecated."]))).toBe("regressed");
    // A new warning outweighs one that went away.
    expect(classifyRecheck(passing(["Old warning."]), passing(["New warning."]))).toBe("regressed");
    const failing = [gate("typecheck", "failed", [], ["Property 'color' does not exist on Button."]), ...passing().slice(1)];
    expect(classifyRecheck(passing(), failing)).toBe("broken");
  });

  it("is stale when the runtime build differs from its latest re-check's, or its acceptance's", () => {
    const version = { snapshot: { runtimeHash: "old" } } as Parameters<typeof isStale>[0];
    expect(isStale(version, null, "new")).toBe(true);
    expect(isStale(version, null, "old")).toBe(false);
    expect(isStale(version, { runtimeHash: "new" }, "new")).toBe(false);
  });

  describe("on the store", () => {
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

    /** An accepted template version, accepted on an earlier runtime build. */
    async function accepted(): Promise<string> {
      const [approver] = await connection.db.select().from(personas).where(eq(personas.workspaceId, workspaceId)).orderBy(personas.createdAt);
      const generationId = await startGeneration(connection.db, workspaceId, { intent: "Review and release today's urgent payments before cut-off", scope: "page", personaIds: [approver!.id], variants: 1 });
      await orchestrateGeneration(generationId);
      const [variant] = await connection.db.select().from(variants).where(eq(variants.generationId, generationId));
      const { prototypeId } = await keepVariant(connection.db, workspaceId, variant!.id, "");
      await connection.db.update(versions).set({ audit: { violations: [], at: "2026-10-16T09:00:00.000Z" }, runtimeHash: "earlier-build" }).where(eq(versions.prototypeId, prototypeId));
      const { version } = await acceptVersion(connection.db, workspaceId, variant!.versionId!, { title: "Urgent payments queue", description: "Payments that need action lead.", brand: "payments", tags: ["Payments"], displayName: null }, null);
      return version.id;
    }

    it("starts one re-check when two requests see the same stale version", async () => {
      const versionId = await accepted();
      const [first, second] = await Promise.all([claimRecheck(connection.db, versionId), claimRecheck(connection.db, versionId)]);
      expect([first, second].filter(Boolean)).toHaveLength(1);
      expect(await connection.db.select().from(templateRechecks)).toHaveLength(1);
      // A claim that never finished is taken over once it times out.
      const later = new Date(Date.now() + RECHECK_TIMEOUT_MS + 1_000);
      const [retaken, again] = await Promise.all([claimRecheck(connection.db, versionId, RUNTIME.hash, "1.73.0", later), claimRecheck(connection.db, versionId, RUNTIME.hash, "1.73.0", later)]);
      expect([retaken, again].filter(Boolean)).toEqual([first ?? second]);
    });

    it("recompiles and re-runs the gates without a model call, storing the result and leaving the template version unchanged (Re-check after an upgrade)", async () => {
      const versionId = await accepted();
      const [before] = await connection.db.select().from(templateVersions).where(eq(templateVersions.id, versionId));
      const started: string[] = [];
      const [template] = await liveTemplates(connection.db);
      const claimed = await recheckStale(connection.db, template!.versions.map((version) => ({ version, recheck: null })), async (id) => void started.push(id));
      expect(claimed).toEqual(started);
      expect(await runRecheck(connection.db, claimed[0]!)).toBe("unchanged");
      const [recheck] = await connection.db.select().from(templateRechecks);
      expect(recheck).toMatchObject({ runtimeHash: RUNTIME.hash, saltRelease: "1.73.0", status: "unchanged" });
      expect(recheck!.compiled).toContain("__fabricatePrototype");
      expect(recheck!.gates?.map((result) => result.gate).sort()).toEqual(["build", "salt-only", "salt-usage", "typecheck"]);
      const [after] = await connection.db.select().from(templateVersions).where(eq(templateVersions.id, versionId));
      expect(after).toEqual(before);
      // Fresh for this build now, so nothing more is claimed.
      const [again] = await liveTemplates(connection.db);
      expect(again!.recheck?.status).toBe("unchanged");
      expect(await recheckStale(connection.db, again!.versions.map((version) => ({ version, recheck: again!.recheck })), async () => {})).toEqual([]);
    });

    it("marks a version whose code no longer typechecks Broken, with the type errors", async () => {
      const versionId = await accepted();
      const [row] = await connection.db.select().from(templateVersions).where(eq(templateVersions.id, versionId));
      // As if Salt removed a property the code uses: the code now passes one Button doesn't accept.
      const broken = row!.snapshot.code.replace("<Button", '<Button madeUpProperty="yes"');
      expect(broken).not.toBe(row!.snapshot.code);
      await connection.db.update(templateVersions).set({ snapshot: { ...row!.snapshot, code: broken } }).where(eq(templateVersions.id, versionId));
      const id = await claimRecheck(connection.db, versionId);
      expect(await runRecheck(connection.db, id!)).toBe("broken");
      const [recheck] = await connection.db.select().from(templateRechecks);
      expect(recheck!.gates?.find((result) => result.gate === "typecheck")).toMatchObject({ status: "failed", issues: [expect.objectContaining({ message: expect.stringContaining("madeUpProperty") })] });
    });
  });
});
