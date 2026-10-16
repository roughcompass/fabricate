import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getConfig, loadConfig, setConfig, withOverrides } from "@/lib/config";
import { ValidationError } from "@/lib/db/errors";
import { newWorkspaceKey } from "@/lib/demo/workspace-key";
import { type PrototypesConnection, setPrototypesDb } from "@/lib/prototypes/db/client";
import { generations, personas, variants, versions } from "@/lib/prototypes/db/schema";
import { startHeroGeneration } from "@/lib/prototypes/pipeline/start";
import { saltRegistry } from "@/lib/prototypes/salt/adapter";
import { PORTAL_ADDENDUM, instructions } from "@/lib/prototypes/salt-kit";
import { ensurePrototypesWorkspace } from "@/lib/prototypes/workspace";
import { orchestrateGeneration } from "@/workflows/prototypes/orchestrate";
import { createPrototypesTestDb } from "../support/prototypes-db";

// converge-templates-and-prototypes, design decision 6: hero generation's portal scopes and the Salt kit addendum.

describe("hero generation", () => {
  let connection: PrototypesConnection;
  let workspaceId: string;
  let personaId: string;
  const original = getConfig();

  beforeEach(async () => {
    setConfig(withOverrides(loadConfig({ environment: "test" }), { prototypes: { models: { generate: "mock", plan: "mock", review: "mock", learn: "mock" } } }));
    connection = await createPrototypesTestDb();
    await setPrototypesDb(connection);
    workspaceId = (await ensurePrototypesWorkspace(connection.db, newWorkspaceKey())).id;
    personaId = (await connection.db.select().from(personas).where(eq(personas.workspaceId, workspaceId)).orderBy(personas.createdAt))[0]!.id;
  });

  afterEach(async () => {
    await setPrototypesDb(undefined);
    setConfig(original);
  });

  it("writes a portal microfrontend that records its scope and hero, and passes every gate with @deweb/portal allowed", async () => {
    const generationId = await startHeroGeneration(connection.db, workspaceId, { intent: "The payee list of the Payments workspace hero: search payees and select one to pay", scope: "portal-member", personaIds: [personaId], hero: { slug: "payments-workspace", member: "payee-list" } });
    await orchestrateGeneration(generationId);

    const [generation] = await connection.db.select().from(generations).where(eq(generations.id, generationId));
    expect(generation).toMatchObject({ scope: "portal-member", hero: { slug: "payments-workspace", member: "payee-list" }, lessons: [] });
    const [variant] = await connection.db.select().from(variants).where(eq(variants.generationId, generationId));
    const [version] = await connection.db.select().from(versions).where(eq(versions.id, variant!.versionId!));
    expect(version).toMatchObject({ scope: "portal-member", status: "ready", gatesPassed: true });
    expect(version!.code).toContain('from "@deweb/portal"');
    expect(version!.code).toContain('usePublish("payee-list")');
    expect(version!.attempts[0]!.gates.map((result) => [result.gate, result.status])).toEqual([
      ["salt-only", "passed"],
      ["typecheck", "passed"],
      ["salt-usage", "passed"],
      ["build", "passed"],
    ]);
    expect(version!.provenance).toMatchObject({ scope: "portal-member", hero: "payments-workspace" });
  });

  it("gives the generator the portal addendum for portal scopes only", async () => {
    const registry = await saltRegistry();
    expect(instructions(registry, [], { portal: true })).toContain(PORTAL_ADDENDUM);
    expect(instructions(registry, [])).not.toContain("@deweb/portal");
    expect(PORTAL_ADDENDUM).toMatch(/useBus[\s\S]*usePublish[\s\S]*useProfile[\s\S]*useRoute[\s\S]*planted\.blockMainThread/);
    expect(PORTAL_ADDENDUM).toMatch(/main[\s\S]*side[\s\S]*wide/);
    expect(PORTAL_ADDENDUM).toContain("./data");
  });

  it("names the member of a microfrontend", async () => {
    await expect(startHeroGeneration(connection.db, workspaceId, { intent: "A microfrontend without a member id", scope: "portal-member", personaIds: [], hero: { slug: "payments-workspace", member: null } })).rejects.toThrow(ValidationError);
  });
});
