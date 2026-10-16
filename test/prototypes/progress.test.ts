import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { generatePublicId } from "@/lib/db/ids";
import { newWorkspaceKey } from "@/lib/demo/workspace-key";
import type { PrototypesConnection } from "@/lib/prototypes/db/client";
import { feedback, generations, versions } from "@/lib/prototypes/db/schema";
import { PROGRESS_LIMIT, progressRows, progressSummary } from "@/lib/prototypes/progress";
import type { Attempt, LessonCopy } from "@/lib/prototypes/types";
import { ensurePrototypesWorkspace } from "@/lib/prototypes/workspace";
import { createPrototypesTestDb } from "../support/prototypes-db";

// prototypes/learning spec: "The Lessons page records progress per generation"
// and "The progress summary compares early and recent generations".

const attempt = (passed: boolean, number = 1): Attempt => ({ number, gates: [], passed, at: "2026-10-16T09:00:00.000Z" });
const lesson = (id: string): LessonCopy => ({ id, text: "Lead with the exceptions.", scope: { kind: "general" }, category: "Content" });

describe("progress", () => {
  let connection: PrototypesConnection;
  let workspaceId: string;
  const start = new Date("2026-10-01T09:00:00.000Z");

  beforeEach(async () => {
    connection = await createPrototypesTestDb();
    workspaceId = (await ensurePrototypesWorkspace(connection.db, newWorkspaceKey())).id;
  });

  afterEach(async () => {
    await connection.close();
  });

  /** One finished generation, minutes apart, with one version per entry in `made`. */
  async function generation(index: number, made: readonly { attempts: readonly Attempt[]; fit?: number; rating?: number; status?: "ready" | "failed" }[], options: { lessons?: number; kind?: "generate" | "refine" | "lesson-check"; status?: "done" | "failed" | "running" } = {}) {
    const id = generatePublicId("gen");
    await connection.db.insert(generations).values({
      id,
      workspaceId,
      kind: options.kind ?? "generate",
      intent: `Intent ${index}`,
      scope: "page",
      personas: [],
      variantCount: made.length,
      status: options.status ?? "done",
      lessons: Array.from({ length: options.lessons ?? 0 }, (_, n) => lesson(`lsn_${n}`)),
      createdAt: new Date(start.getTime() + index * 60_000),
    });
    for (const version of made) {
      const versionId = generatePublicId("ver");
      await connection.db.insert(versions).values({ id: versionId, workspaceId, generationId: id, status: version.status ?? "ready", scope: "page", attempts: [...version.attempts], fitAverage: version.fit ?? null });
      if (version.rating) await connection.db.insert(feedback).values({ id: generatePublicId("fbk"), workspaceId, kind: "rating", versionId, personas: [], rating: version.rating });
    }
    return id;
  }

  it("records each generation's first-attempt result, repairs, fit, rating, and lessons, oldest first (Progress per generation)", async () => {
    const first = await generation(0, [{ attempts: [attempt(true)], fit: 4, rating: 5 }, { attempts: [attempt(false), attempt(true, 2)], fit: 3 }], { lessons: 1 });
    await generation(1, [{ attempts: [attempt(true)], fit: 4.5, rating: 4 }], { kind: "refine" });
    await generation(2, [{ attempts: [attempt(false), attempt(false, 2), attempt(false, 3)], status: "failed" }], { status: "failed" });
    // Running generations and lesson checks are not progress.
    await generation(3, [{ attempts: [attempt(true)] }], { status: "running" });
    await generation(4, [{ attempts: [attempt(true)] }], { kind: "lesson-check" });

    const rows = await progressRows(connection.db, workspaceId);
    expect(rows.map((row) => row.intent)).toEqual(["Intent 0", "Intent 1", "Intent 2"]);
    expect(rows[0]).toMatchObject({ generationId: first, kind: "generate", firstPass: false, repairs: 1, fit: 3.5, rating: 5, lessons: 1 });
    expect(rows[1]).toMatchObject({ kind: "refine", firstPass: true, repairs: 0, fit: 4.5, rating: 4, lessons: 0 });
    // A failed version has no fit or rating, but its repairs count.
    expect(rows[2]).toMatchObject({ firstPass: false, repairs: 2, fit: null, rating: null });
  });

  it("shows only the latest generations, up to the limit", async () => {
    for (let index = 0; index < PROGRESS_LIMIT + 2; index++) await generation(index, [{ attempts: [attempt(true)] }]);
    const rows = await progressRows(connection.db, workspaceId);
    expect(rows).toHaveLength(PROGRESS_LIMIT);
    expect(rows[0]!.intent).toBe("Intent 2");
  });

  it("compares the earliest five with the latest five, and says when there isn't enough data (Progress summary)", async () => {
    for (let index = 0; index < 5; index++) await generation(index, [{ attempts: index < 2 ? [attempt(false), attempt(true, 2)] : [attempt(true)], fit: 3 }]);
    expect(progressSummary(await progressRows(connection.db, workspaceId))).toEqual({ enough: false, earliest: null, latest: null });

    for (let index = 5; index < 8; index++) await generation(index, [{ attempts: [attempt(true)], fit: 4.5, rating: 4 }], { lessons: 2 });
    const summary = progressSummary(await progressRows(connection.db, workspaceId));
    expect(summary.enough).toBe(true);
    // Earliest: generations 0-4, two of which needed a repair.
    expect(summary.earliest).toEqual({ firstPassRate: 0.6, repairs: 0.4, fit: 3, rating: null, lessons: 0 });
    // Latest: generations 3-7; they overlap the earliest when there are fewer than ten.
    expect(summary.latest).toEqual({ firstPassRate: 1, repairs: 0, fit: 3.9, rating: 4, lessons: 1.2 });
  });
});
