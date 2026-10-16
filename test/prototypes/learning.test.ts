import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getConfig, loadConfig, setConfig, withOverrides } from "@/lib/config";
import { newWorkspaceKey } from "@/lib/demo/workspace-key";
import { type PrototypesConnection, setPrototypesDb } from "@/lib/prototypes/db/client";
import { lessons, personas, variants } from "@/lib/prototypes/db/schema";
import { addNote, rateVersion } from "@/lib/prototypes/feedback";
import { acceptLesson, addLesson, listLessons, setLessonActive } from "@/lib/prototypes/lessons";
import { proposeLessons, recurringFailures } from "@/lib/prototypes/pipeline/learn";
import { startGeneration } from "@/lib/prototypes/pipeline/start";
import { discardVariant, keepVariant } from "@/lib/prototypes/variants";
import { ensurePrototypesWorkspace } from "@/lib/prototypes/workspace";
import { orchestrateGeneration } from "@/workflows/prototypes/orchestrate";
import { createPrototypesTestDb } from "../support/prototypes-db";

const NOTE = "Too many columns; the approver only needs payee, amount, cut-off, and status";

// prototypes/learning spec, on the scripted model.
describe("learning", () => {
  let connection: PrototypesConnection;
  let workspaceId: string;
  let approver: string;
  const original = getConfig();

  beforeEach(async () => {
    setConfig(withOverrides(loadConfig({ environment: "test" }), { prototypes: { models: { generate: "mock", plan: "mock", review: "mock", learn: "mock" } } }));
    connection = await createPrototypesTestDb();
    await setPrototypesDb(connection);
    workspaceId = (await ensurePrototypesWorkspace(connection.db, newWorkspaceKey())).id;
    approver = (await connection.db.select().from(personas).where(eq(personas.workspaceId, workspaceId)).orderBy(personas.createdAt))[0]!.id;
  });

  afterEach(async () => {
    await setPrototypesDb(undefined);
    setConfig(original);
  });

  const generate = async (intent = "Review and release today's urgent payments before cut-off", count = 1) => {
    const id = await startGeneration(connection.db, workspaceId, { intent, scope: "page", personaIds: [approver], variants: count });
    await orchestrateGeneration(id);
    return connection.db.select().from(variants).where(eq(variants.generationId, id)).orderBy(variants.position);
  };
  const proposed = async () => (await listLessons(connection.db, workspaceId)).filter((lesson) => lesson.status === "proposed");

  it("proposes a lesson from a rating's note, scoped and citing the note (Lesson from a rating note)", async () => {
    const [variant] = await generate();
    const rating = await rateVersion(connection.db, workspaceId, variant!.versionId!, 2, NOTE);
    expect(await proposeLessons(connection.db, workspaceId, [rating.id])).toBe(1);
    const [lesson] = await proposed();
    expect(lesson).toMatchObject({ category: "Content", source: "agent", citations: [{ kind: "feedback", feedbackId: rating.id }] });
    expect(lesson?.text).toContain("the approver only needs payee, amount, cut-off, and status");
  });

  it("proposes nothing from a rating without a note (Rating without a note)", async () => {
    const [variant] = await generate();
    const rating = await rateVersion(connection.db, workspaceId, variant!.versionId!, 2, "");
    expect(await proposeLessons(connection.db, workspaceId, [rating.id])).toBe(0);
    expect(await proposed()).toEqual([]);
  });

  it("proposes lessons from a keep reason, a discard reason, and an element note", async () => {
    const rows = await generate("Review and release today's urgent payments before cut-off", 3);
    const kept = await keepVariant(connection.db, workspaceId, rows[0]!.id, "Cut-off is visible without scrolling");
    const discarded = await discardVariant(connection.db, workspaceId, rows[1]!.id, "Approvers can't see the cut-off without scrolling");
    const note = await addNote(connection.db, workspaceId, rows[2]!.versionId!, "Needs a confirm step for amounts over 1m", { component: "Button", locator: "table > tbody > tr", text: "Approve", image: null });
    for (const id of [kept.feedbackId!, discarded!, note.id]) expect(await proposeLessons(connection.db, workspaceId, [id]), id).toBe(1);
    expect((await proposed()).map((lesson) => lesson.citations[0])).toEqual([
      { kind: "feedback", feedbackId: kept.feedbackId },
      { kind: "feedback", feedbackId: discarded },
      { kind: "feedback", feedbackId: note.id },
    ]);
  });

  it("proposes a Salt usage lesson when the same check fails in two generations, citing both (Lesson from a recurring check failure)", async () => {
    await generate("Review urgent payments #mock-fail-once");
    expect(await recurringFailures(connection.db, workspaceId)).toEqual([]);
    expect(await proposed()).toEqual([]);
    // The second generation's failure recurs, so finishing it proposes the lesson.
    await generate("Release urgent payments #mock-fail-once");
    const [lesson] = await proposed();
    expect(lesson).toMatchObject({ category: "Salt usage", text: "Don't pass size to Salt's Button; it has no size property." });
    expect(lesson?.citations).toEqual([{ kind: "failure", signature: "typecheck:TS2322:Button.size", versionIds: expect.any(Array) }]);
    expect((lesson?.citations[0] as { versionIds: readonly string[] }).versionIds).toHaveLength(2);
    // Once a lesson cites it, the failure doesn't trigger another proposal.
    expect(await recurringFailures(connection.db, workspaceId)).toEqual([]);
  });

  it("turns a proposal identical to an existing lesson into an edit of it, and accepting updates that lesson (Similar lesson exists)", async () => {
    const existing = await addLesson(connection.db, workspaceId, { text: `For approval queues, ${NOTE.charAt(0).toLowerCase()}${NOTE.slice(1)}.`, category: "Content", scope: { kind: "general" } });
    const [variant] = await generate();
    const rating = await rateVersion(connection.db, workspaceId, variant!.versionId!, 2, NOTE);
    await proposeLessons(connection.db, workspaceId, [rating.id]);
    const [edit] = await proposed();
    expect(edit?.editsLessonId).toBe(existing.id);
    await acceptLesson(connection.db, workspaceId, edit!.id);
    const all = await connection.db.select().from(lessons).where(eq(lessons.workspaceId, workspaceId));
    expect(all).toHaveLength(1);
    expect(all[0]?.citations).toEqual([{ kind: "feedback", feedbackId: rating.id }]);
  });

  it("applies a lesson written directly to the next generation, and none once it is turned off (Writing a lesson directly; Turning a lesson off)", async () => {
    const lesson = await addLesson(connection.db, workspaceId, { text: "Always show amounts with currency codes, right-aligned.", category: "Content", scope: { kind: "general" } });
    expect(lesson.status).toBe("active");
    const generationWith = (await generate())[0]!;
    await setLessonActive(connection.db, workspaceId, lesson.id, false);
    const generationWithout = (await generate())[0]!;
    const { versions } = await import("@/lib/prototypes/db/schema");
    const [withLesson] = await connection.db.select().from(versions).where(eq(versions.id, generationWith.versionId!));
    const [without] = await connection.db.select().from(versions).where(eq(versions.id, generationWithout.versionId!));
    expect(withLesson?.provenance?.lessons.map((entry) => entry.id)).toEqual([lesson.id]);
    expect(without?.provenance?.lessons).toEqual([]);
    expect(withLesson?.provenance?.lessons[0]?.text).toBe("Always show amounts with currency codes, right-aligned.");
  });

  it("applies a persona's lesson only to generations for that persona (Persona lesson)", async () => {
    const people = await connection.db.select().from(personas).where(eq(personas.workspaceId, workspaceId)).orderBy(personas.createdAt);
    const trader = people.find((persona) => persona.role === "FX and rates sales-trader")!;
    await addLesson(connection.db, workspaceId, { text: "Show cut-off times in every row.", category: "Persona need", scope: { kind: "persona", personaId: approver, personaName: people[0]!.name } });
    const id = await startGeneration(connection.db, workspaceId, { intent: "Quote client requests for quote quickly", scope: "page", personaIds: [trader.id], variants: 1 });
    const { generations } = await import("@/lib/prototypes/db/schema");
    const [generation] = await connection.db.select().from(generations).where(eq(generations.id, id));
    expect(generation?.lessons).toEqual([]);
  });
});
