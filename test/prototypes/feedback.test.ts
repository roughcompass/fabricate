import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getConfig, loadConfig, setConfig, withOverrides } from "@/lib/config";
import { ValidationError } from "@/lib/db/errors";
import { newWorkspaceKey } from "@/lib/demo/workspace-key";
import { type PrototypesConnection, setPrototypesDb } from "@/lib/prototypes/db/client";
import { feedback, variants } from "@/lib/prototypes/db/schema";
import { addNote, feedbackFor, rateVersion, ratingsOf, setNoteStatus } from "@/lib/prototypes/feedback";
import { startGeneration } from "@/lib/prototypes/pipeline/start";
import { ensurePrototypesWorkspace } from "@/lib/prototypes/workspace";
import { orchestrateGeneration } from "@/workflows/prototypes/orchestrate";
import { createPrototypesTestDb } from "../support/prototypes-db";

// prototypes/learning spec: ratings and element notes.
describe("feedback", () => {
  let connection: PrototypesConnection;
  let workspaceId: string;
  let versionId: string;
  const original = getConfig();

  beforeEach(async () => {
    setConfig(withOverrides(loadConfig({ environment: "test" }), { prototypes: { models: { generate: "mock", plan: "mock", review: "mock", learn: "mock" } } }));
    connection = await createPrototypesTestDb();
    await setPrototypesDb(connection);
    workspaceId = (await ensurePrototypesWorkspace(connection.db, newWorkspaceKey())).id;
    const id = await startGeneration(connection.db, workspaceId, { intent: "Review and release today's urgent payments", scope: "page", personaIds: [], variants: 1 });
    await orchestrateGeneration(id);
    versionId = (await connection.db.select().from(variants).where(eq(variants.generationId, id)))[0]!.versionId!;
  });

  afterEach(async () => {
    await setPrototypesDb(undefined);
    setConfig(original);
  });

  it("replaces an earlier rating of the same version (Rating a version)", async () => {
    await rateVersion(connection.db, workspaceId, versionId, 4, "");
    await rateVersion(connection.db, workspaceId, versionId, 2, "Too many columns; the approver only needs payee, amount, cut-off, and status");
    const ratings = (await connection.db.select().from(feedback).where(eq(feedback.versionId, versionId))).filter((entry) => entry.kind === "rating");
    expect(ratings).toHaveLength(1);
    expect(ratings[0]).toMatchObject({ rating: 2, text: "Too many columns; the approver only needs payee, amount, cut-off, and status" });
    expect((await ratingsOf(connection.db, [versionId])).get(versionId)).toBe(2);
  });

  it("refuses a rating outside 1 to 5 and a note over 2,000 characters", async () => {
    await expect(rateVersion(connection.db, workspaceId, versionId, 6, "")).rejects.toThrow(ValidationError);
    await expect(rateVersion(connection.db, workspaceId, versionId, 3, "x".repeat(2_001))).rejects.toThrow("Keep the note to 2,000 characters.");
  });

  it("keeps an element note open until it is resolved, and lets it open again", async () => {
    const note = await addNote(connection.db, workspaceId, versionId, "Needs a confirm step for amounts over 1m", { component: "Button", locator: "table > tbody > tr > td > button", text: "Approve", image: null });
    expect(note.noteStatus).toBe("open");
    expect((await setNoteStatus(connection.db, workspaceId, note.id, "resolved")).noteStatus).toBe("resolved");
    expect((await setNoteStatus(connection.db, workspaceId, note.id, "open")).noteStatus).toBe("open");
    expect((await feedbackFor(connection.db, versionId)).map((entry) => entry.kind)).toEqual(["note"]);
  });
});
