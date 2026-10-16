import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { keyDigest } from "@/lib/demo/workspace-digest";
import { newWorkspaceKey } from "@/lib/demo/workspace-key";
import { keyDigest as demoKeyDigest } from "@/lib/demo/workspaces";
import type { PrototypesConnection } from "@/lib/prototypes/db/client";
import { benchmarkIntents, pageShells, personas, workspaces } from "@/lib/prototypes/db/schema";
import { PROTOTYPE_LIMIT, PrototypesLimitError } from "@/lib/prototypes/limits";
import { claimSlot, claimVariants, ensurePrototypesWorkspace, findPrototypesWorkspace, limitResetsAt, releaseSlot, remainingToday } from "@/lib/prototypes/workspace";
import { createPrototypesTestDb } from "../support/prototypes-db";

// prototypes/availability spec: anonymous workspaces and their bounds.
describe("Prototypes workspaces", () => {
  let connection: PrototypesConnection;
  const now = new Date("2026-10-16T09:30:00.000Z");

  beforeEach(async () => {
    connection = await createPrototypesTestDb();
  });

  afterEach(async () => {
    await connection.close();
  });

  it("maps one browser credential to one workspace, keyed by the template demo's digest (One identity across the demo and Prototypes)", async () => {
    const key = newWorkspaceKey();
    const first = await ensurePrototypesWorkspace(connection.db, key, now);
    const again = await ensurePrototypesWorkspace(connection.db, key, now);
    expect(again.id).toBe(first.id);
    expect(first.credentialDigest).toBe(demoKeyDigest(key));
    expect(first.credentialDigest).toBe(keyDigest(key));
    expect(await findPrototypesWorkspace(connection.db, key)).toMatchObject({ id: first.id });
    expect(await connection.db.select().from(workspaces)).toHaveLength(1);

    const other = await ensurePrototypesWorkspace(connection.db, newWorkspaceKey(), now);
    expect(other.id).not.toBe(first.id);
  });

  it("creates one workspace when two first requests race", async () => {
    const key = newWorkspaceKey();
    const [a, b] = await Promise.all([ensurePrototypesWorkspace(connection.db, key, now), ensurePrototypesWorkspace(connection.db, key, now)]);
    expect(a.id).toBe(b.id);
    expect(await connection.db.select().from(personas)).toHaveLength(5);
  });

  it("seeds five example personas, the default shell, and three benchmark intents (First visit)", async () => {
    const workspace = await ensurePrototypesWorkspace(connection.db, newWorkspaceKey(), now);
    const seeded = await connection.db.select().from(personas).where(eq(personas.workspaceId, workspace.id));
    expect(seeded.map((persona) => persona.role)).toEqual(["Treasury payments approver", "Group treasurer", "FX and rates sales-trader", "Client onboarding (KYC) analyst", "Corporate relationship banker"]);
    expect(seeded.every((persona) => persona.example)).toBe(true);
    const [shell] = await connection.db.select().from(pageShells).where(eq(pageShells.workspaceId, workspace.id));
    expect(shell?.config.nav.map((item) => item.label)).toEqual(["Overview", "Payments", "Accounts", "Liquidity", "Reports"]);
    const benchmarks = await connection.db.select().from(benchmarkIntents).where(eq(benchmarkIntents.workspaceId, workspace.id));
    expect(benchmarks).toHaveLength(3);
    expect(benchmarks.every((benchmark) => benchmark.personaIds.every((id) => seeded.some((persona) => persona.id === id)))).toBe(true);
    expect(workspace.personaCount).toBe(5);
  });

  describe("daily variant limit", () => {
    it("takes variants from today's allowance and refuses a request over it (Limit reached)", async () => {
      const workspace = await ensurePrototypesWorkspace(connection.db, newWorkspaceKey(), now);
      expect(await claimVariants(connection.db, workspace.id, 28, 30, now)).toEqual({ remaining: 2 });

      const refusal = claimVariants(connection.db, workspace.id, 3, 30, now);
      await expect(refusal).rejects.toThrow(PrototypesLimitError);
      await expect(claimVariants(connection.db, workspace.id, 3, 30, now)).rejects.toThrow("Only 2 of today's 30 generations remain, so ask for 2 or fewer variants. More are available from 00:00 UTC tomorrow.");
      const [row] = await connection.db.select().from(workspaces).where(eq(workspaces.id, workspace.id));
      expect(row?.variantsToday).toBe(28);
      expect(remainingToday(row!, 30, now)).toBe(2);
    });

    it("lets concurrent requests take only what remains", async () => {
      const workspace = await ensurePrototypesWorkspace(connection.db, newWorkspaceKey(), now);
      await claimVariants(connection.db, workspace.id, 27, 30, now);
      const results = await Promise.allSettled([1, 2, 3].map(() => claimVariants(connection.db, workspace.id, 2, 30, now)));
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      const [row] = await connection.db.select().from(workspaces).where(eq(workspaces.id, workspace.id));
      expect(row?.variantsToday).toBe(29);
    });

    it("resets at midnight UTC", async () => {
      const workspace = await ensurePrototypesWorkspace(connection.db, newWorkspaceKey(), now);
      await claimVariants(connection.db, workspace.id, 30, 30, now);
      await expect(claimVariants(connection.db, workspace.id, 1, 30, now)).rejects.toThrow("used all 30 of today's generations");
      const tomorrow = new Date("2026-10-17T00:00:01.000Z");
      expect(limitResetsAt(now)).toEqual(new Date("2026-10-17T00:00:00.000Z"));
      expect(await claimVariants(connection.db, workspace.id, 3, 30, tomorrow)).toEqual({ remaining: 27 });
    });
  });

  it("refuses the 51st prototype and saves nothing for it (Too many prototypes)", async () => {
    const workspace = await ensurePrototypesWorkspace(connection.db, newWorkspaceKey(), now);
    for (let index = 0; index < PROTOTYPE_LIMIT; index++) await claimSlot(connection.db, workspace.id, "prototypeCount", PROTOTYPE_LIMIT, "limit");
    await expect(claimSlot(connection.db, workspace.id, "prototypeCount", PROTOTYPE_LIMIT, "A workspace can hold 50 prototypes.")).rejects.toThrow("A workspace can hold 50 prototypes.");
    let [row] = await connection.db.select().from(workspaces).where(eq(workspaces.id, workspace.id));
    expect(row?.prototypeCount).toBe(50);
    await releaseSlot(connection.db, workspace.id, "prototypeCount");
    await claimSlot(connection.db, workspace.id, "prototypeCount", PROTOTYPE_LIMIT, "limit");
    [row] = await connection.db.select().from(workspaces).where(eq(workspaces.id, workspace.id));
    expect(row?.prototypeCount).toBe(50);
  });
});
