import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getConfig, loadConfig, setConfig, withOverrides } from "@/lib/config";
import { ValidationError } from "@/lib/db/errors";
import { newWorkspaceKey } from "@/lib/demo/workspace-key";
import { type PrototypesConnection, setPrototypesDb } from "@/lib/prototypes/db/client";
import { versions } from "@/lib/prototypes/db/schema";
import { PERSONA_LIMIT, PrototypesLimitError } from "@/lib/prototypes/limits";
import { createPersona, deletePersona, listPersonas, updatePersona } from "@/lib/prototypes/personas";
import { startGeneration } from "@/lib/prototypes/pipeline/start";
import { ensurePrototypesWorkspace } from "@/lib/prototypes/workspace";
import { orchestrateGeneration } from "@/workflows/prototypes/orchestrate";
import { createPrototypesTestDb } from "../support/prototypes-db";

// prototypes/personas spec.
describe("personas", () => {
  let connection: PrototypesConnection;
  let workspaceId: string;
  const original = getConfig();
  const fields = { name: "Priya, payments approver", role: "Treasury payments approver", organizationType: "", goals: ["Release today's urgent payments before the 3pm cut-off"], context: "", constraints: ["Four-eyes approval on payments over USD 1m"], distinction: null };

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

  it("requires a name, a role, and one to five goals (Missing goal)", async () => {
    const error = await createPersona(connection.db, workspaceId, { ...fields, name: " ", goals: [] }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).issues.map((issue) => issue.field)).toEqual(["name", "goals"]);
    await expect(createPersona(connection.db, workspaceId, { ...fields, goals: ["a", "b", "c", "d", "e", "f"] })).rejects.toThrow("List at most 5 goals.");
  });

  it("keeps each version's copy of a persona when the persona is edited (Editing after generation)", async () => {
    const persona = await createPersona(connection.db, workspaceId, fields);
    const id = await startGeneration(connection.db, workspaceId, { intent: "Review and release today's urgent payments", scope: "page", personaIds: [persona.id], variants: 1 });
    await orchestrateGeneration(id);
    await updatePersona(connection.db, workspaceId, persona.id, { ...fields, goals: ["See every payment due this week"] });
    const [version] = await connection.db.select().from(versions).where(eq(versions.generationId, id));
    expect(version?.provenance?.personas[0]?.goals).toEqual(["Release today's urgent payments before the 3pm cut-off"]);
    await deletePersona(connection.db, workspaceId, persona.id);
    const [kept] = await connection.db.select().from(versions).where(eq(versions.generationId, id));
    expect(kept?.provenance?.personas[0]?.name).toBe("Priya, payments approver");
    expect((await listPersonas(connection.db, workspaceId)).map((entry) => entry.id)).not.toContain(persona.id);
  });

  it("holds at most 30 personas in a workspace", async () => {
    for (let index = (await listPersonas(connection.db, workspaceId)).length; index < PERSONA_LIMIT; index++) await createPersona(connection.db, workspaceId, { ...fields, name: `Persona ${index}` });
    await expect(createPersona(connection.db, workspaceId, fields)).rejects.toThrow(PrototypesLimitError);
    expect(await listPersonas(connection.db, workspaceId)).toHaveLength(PERSONA_LIMIT);
  });
});
