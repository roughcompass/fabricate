import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getConfig, loadConfig, setConfig, withOverrides } from "@/lib/config";
import { newWorkspaceKey } from "@/lib/demo/workspace-key";
import { type PrototypesConnection, setPrototypesDb } from "@/lib/prototypes/db/client";
import { generations, lessonChecks, lessons, workspaces } from "@/lib/prototypes/db/schema";
import { lessonCheckSummary, listBenchmarks, pairWinner, startLessonCheck, updateBenchmark } from "@/lib/prototypes/lesson-check";
import { PrototypesLimitError } from "@/lib/prototypes/limits";
import { progressRows } from "@/lib/prototypes/progress";
import { ensurePrototypesWorkspace } from "@/lib/prototypes/workspace";
import { orchestrateLessonCheck } from "@/workflows/prototypes/orchestrate";
import { createPrototypesTestDb } from "../support/prototypes-db";

// prototypes/learning spec: "A lesson check measures whether lessons help" and
// "Benchmark intents are workspace data", on the scripted model.

describe("lesson checks", () => {
  let connection: PrototypesConnection;
  let workspaceId: string;
  const original = getConfig();

  beforeEach(async () => {
    setConfig(withOverrides(loadConfig({ environment: "test" }), { prototypes: { models: { generate: "mock", plan: "mock", review: "mock", learn: "mock" }, dailyVariantLimit: 30 } }));
    connection = await createPrototypesTestDb();
    await setPrototypesDb(connection);
    workspaceId = (await ensurePrototypesWorkspace(connection.db, newWorkspaceKey())).id;
  });

  afterEach(async () => {
    await setPrototypesDb(undefined);
    setConfig(original);
  });

  const addLesson = (id: string, text: string) => connection.db.insert(lessons).values({ id, workspaceId, text, scope: { kind: "general" }, category: "Content", status: "active", source: "visitor", citations: [] });

  it("generates six variants, judges each pair, and keeps the intents and lessons it used (Running a lesson check)", async () => {
    await addLesson("lsn_aaaaaaaaaaaaaaaa", "Lead with the payments that need action.");
    await addLesson("lsn_bbbbbbbbbbbbbbbb", "Always show amounts with currency codes, right-aligned.");
    const id = await startLessonCheck(connection.db, workspaceId);
    const [workspace] = await connection.db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
    expect(workspace!.variantsToday).toBe(6);
    await orchestrateLessonCheck(id);

    const made = await connection.db.select().from(generations).where(eq(generations.lessonCheckId, id));
    expect(made).toHaveLength(6);
    expect(made.filter((generation) => generation.withLessons).every((generation) => generation.lessons.length === 2)).toBe(true);
    expect(made.filter((generation) => !generation.withLessons).every((generation) => generation.lessons.length === 0)).toBe(true);

    const [check] = await connection.db.select().from(lessonChecks).where(eq(lessonChecks.id, id));
    expect(check!.status).toBe("done");
    expect(check!.lessons.map((lesson) => lesson.id)).toEqual(["lsn_aaaaaaaaaaaaaaaa", "lsn_bbbbbbbbbbbbbbbb"]);
    expect(check!.intents.map((intent) => intent.intent)).toEqual((await listBenchmarks(connection.db, workspaceId)).map((benchmark) => benchmark.intent));
    expect(check!.result!.pairs).toHaveLength(3);
    expect(check!.result!.won + check!.result!.lost + check!.result!.undecided).toBe(3);
    expect(check!.result!.pairs.every((pair) => pair.withGates === true && pair.withoutGates === true)).toBe(true);
    expect(lessonCheckSummary(check!.result!)).toBe(`With lessons: won ${check!.result!.won}, lost ${check!.result!.lost}, undecided ${check!.result!.undecided}`);
    // Lesson checks aren't progress.
    expect(await progressRows(connection.db, workspaceId)).toEqual([]);
  });

  it("counts a pair only when every persona's verdict agrees", () => {
    const verdict = (winner: "a" | "b" | "undecided") => ({ personaId: null, personaName: "The intent", winner, reasons: [] });
    expect(pairWinner([verdict("a"), verdict("a")])).toBe("with");
    expect(pairWinner([verdict("b")])).toBe("without");
    expect(pairWinner([verdict("a"), verdict("b")])).toBe("undecided");
    expect(pairWinner([verdict("undecided")])).toBe("undecided");
  });

  it("keeps the intent an earlier check used after the benchmark is edited (Editing a benchmark intent)", async () => {
    await addLesson("lsn_aaaaaaaaaaaaaaaa", "Lead with the payments that need action.");
    const id = await startLessonCheck(connection.db, workspaceId);
    const [first] = await listBenchmarks(connection.db, workspaceId);
    const before = first!.intent;
    await updateBenchmark(connection.db, workspaceId, first!.id, { intent: "Approve a corporate card limit increase", scope: "page", personaIds: first!.personaIds });
    expect((await listBenchmarks(connection.db, workspaceId))[0]!.intent).toBe("Approve a corporate card limit increase");
    const [check] = await connection.db.select().from(lessonChecks).where(eq(lessonChecks.id, id));
    expect(check!.intents[0]!.intent).toBe(before);
  });

  it("refuses to start with no active lesson, while another runs, or over today's limit, before any model call", async () => {
    await expect(startLessonCheck(connection.db, workspaceId)).rejects.toThrow("no active lessons");
    await addLesson("lsn_aaaaaaaaaaaaaaaa", "Lead with the payments that need action.");
    await startLessonCheck(connection.db, workspaceId);
    await expect(startLessonCheck(connection.db, workspaceId)).rejects.toThrow("already running");
    await connection.db.delete(lessonChecks);
    await connection.db.update(workspaces).set({ variantsToday: 26 }).where(eq(workspaces.id, workspaceId));
    await expect(startLessonCheck(connection.db, workspaceId)).rejects.toThrow(PrototypesLimitError);
  });
});
