import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getConfig, loadConfig, setConfig, withOverrides } from "@/lib/config";
import { ValidationError } from "@/lib/db/errors";
import { newWorkspaceKey } from "@/lib/demo/workspace-key";
import { type PrototypesConnection, setPrototypesDb } from "@/lib/prototypes/db/client";
import { generations, lessons, personas, variants, versions, workspaces } from "@/lib/prototypes/db/schema";
import { PrototypesLimitError } from "@/lib/prototypes/limits";
import { averageFit } from "@/lib/prototypes/pipeline/review";
import { planProblems } from "@/lib/prototypes/pipeline/plan";
import { GenerationUnavailableError, startGeneration, validateComposer } from "@/lib/prototypes/pipeline/start";
import { registryRelease } from "@/lib/prototypes/salt/adapter";
import { KIT_VERSION } from "@/lib/prototypes/salt-kit";
import { AXES, type Direction, type PersonaReview } from "@/lib/prototypes/types";
import { claimVariants, ensurePrototypesWorkspace } from "@/lib/prototypes/workspace";
import { STALLED_MS, getGeneration } from "@/lib/prototypes/variants";
import { orchestrateGeneration } from "@/workflows/prototypes/orchestrate";
import { createPrototypesTestDb } from "../support/prototypes-db";

const MOCK = { generate: "mock", plan: "mock", review: "mock", learn: "mock" };

// prototypes/generation and quality-checks specs, on the scripted model and the inline runner.
describe("generation pipeline", () => {
  let connection: PrototypesConnection;
  let workspaceId: string;
  let approver: string;
  const original = getConfig();

  beforeEach(async () => {
    setConfig(withOverrides(loadConfig({ environment: "test" }), { prototypes: { models: MOCK, dailyVariantLimit: 30 } }));
    connection = await createPrototypesTestDb();
    await setPrototypesDb(connection);
    workspaceId = (await ensurePrototypesWorkspace(connection.db, newWorkspaceKey())).id;
    const [first] = await connection.db.select().from(personas).where(eq(personas.workspaceId, workspaceId)).orderBy(personas.createdAt);
    approver = first!.id;
  });

  afterEach(async () => {
    await setPrototypesDb(undefined);
    setConfig(original);
  });

  const generate = async (intent: string, count = 3, personaIds = [approver]) => {
    const id = await startGeneration(connection.db, workspaceId, { intent, scope: "page", personaIds, variants: count });
    await orchestrateGeneration(id);
    const rows = await connection.db.select().from(variants).where(eq(variants.generationId, id)).orderBy(variants.position);
    const made = await connection.db.select().from(versions).where(eq(versions.generationId, id));
    const [generation] = await connection.db.select().from(generations).where(eq(generations.id, id));
    return { id, generation: generation!, variants: rows, versions: rows.map((row) => made.find((version) => version.id === row.versionId)) };
  };

  it("refuses an intent that is too short before anything is written (Intent too short)", async () => {
    await expect(startGeneration(connection.db, workspaceId, { intent: "table", scope: "page", personaIds: [], variants: 3 })).rejects.toThrow(ValidationError);
    expect(await connection.db.select().from(generations)).toEqual([]);
  });

  it("offers 1, 2, 3, 4, 6, or 8 variants and refuses any other count (The composer takes an intent, scope, personas, and variant count)", () => {
    const input = { intent: "Review and release today's urgent payments before cut-off", scope: "page" as const, personaIds: [] };
    for (const variants of [1, 2, 3, 4, 6, 8]) expect(validateComposer({ ...input, variants }).variants).toBe(variants);
    for (const variants of [0, 5, 7, 9, 2.5]) expect(() => validateComposer({ ...input, variants }), String(variants)).toThrow(ValidationError);
  });

  it("asks up to four directions to vary different axes, and more to use every axis before one repeats (Variants take distinct design directions)", () => {
    const data = { description: "Payments", source: "export const rows = [] as const;\n" };
    const direction = (index: number, axis: Direction["axis"]): Direction => ({ title: `Direction ${index}`, sentence: "A different way to show the payments.", axis, recipe: null });
    expect(planProblems([direction(0, AXES[0]), direction(1, AXES[0])], data)).toContain("Two directions vary the same axis; give each direction a different axis.");
    const eight = Array.from({ length: 8 }, (_, index) => direction(index, AXES[index % AXES.length]!));
    expect(planProblems(eight, data)).toEqual([]);
    const lopsided = [...eight.slice(0, 5), direction(5, AXES[0]), direction(6, AXES[0]), direction(7, AXES[1])];
    expect(planProblems(lopsided, data)).toContain("The directions don't spread across the axes; use every axis before any axis repeats.");
  });

  it("completes a generation of eight variants with distinct directions", async () => {
    const { variants: rows } = await generate("Review and release today's urgent payments before cut-off", 8);
    expect(rows).toHaveLength(8);
    expect(rows.every((row) => row.status === "ready")).toBe(true);
    expect(new Set(rows.map((row) => row.direction?.title)).size).toBe(8);
  });

  it("ends a variant that stopped without finishing as Failed with Retry, so its generation doesn't stay in progress", async () => {
    const id = await startGeneration(connection.db, workspaceId, { intent: "Review and release today's urgent payments before cut-off", scope: "page", personaIds: [approver], variants: 2 });
    // Nothing ran it, as when the server restarted under a run; one variant moved recently.
    const [first, second] = await connection.db.select().from(variants).where(eq(variants.generationId, id)).orderBy(variants.position);
    await connection.db.update(variants).set({ updatedAt: new Date(Date.now() - STALLED_MS - 1_000) }).where(eq(variants.id, first!.id));
    let view = await getGeneration(connection.db, workspaceId, id);
    expect(view.variants.map(({ variant }) => variant.status)).toEqual(["failed", "running"]);
    expect(view.variants[0]!.variant.failure?.message).toContain("Retry");
    expect(view.generation.status).toBe("running");
    await connection.db.update(variants).set({ updatedAt: new Date(Date.now() - STALLED_MS - 1_000) }).where(eq(variants.id, second!.id));
    view = await getGeneration(connection.db, workspaceId, id);
    expect(view.generation.status).toBe("failed");
  });

  it("refuses a request over today's limit before any model call (Limit reached)", async () => {
    await claimVariants(connection.db, workspaceId, 28, 30);
    await expect(startGeneration(connection.db, workspaceId, { intent: "Review and release today's urgent payments before cut-off", scope: "page", personaIds: [approver], variants: 3 })).rejects.toThrow(PrototypesLimitError);
    expect(await connection.db.select().from(generations)).toEqual([]);
    const [row] = await connection.db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
    expect(row?.variantsToday).toBe(28);
  });

  it("refuses to start when no model credential is configured (Credential missing)", async () => {
    setConfig(withOverrides(loadConfig({ environment: "test", env: {} }), { prototypes: { models: { ...MOCK, generate: "anthropic/claude-opus-5.5" } } }));
    const saved = { key: process.env.AI_GATEWAY_API_KEY, oidc: process.env.VERCEL_OIDC_TOKEN };
    delete process.env.AI_GATEWAY_API_KEY;
    delete process.env.VERCEL_OIDC_TOKEN;
    try {
      await expect(startGeneration(connection.db, workspaceId, { intent: "Review and release today's urgent payments", scope: "page", personaIds: [], variants: 1 })).rejects.toThrow(GenerationUnavailableError);
    } finally {
      if (saved.key) process.env.AI_GATEWAY_API_KEY = saved.key;
      if (saved.oidc) process.env.VERCEL_OIDC_TOKEN = saved.oidc;
    }
  });

  it("plans distinct directions with one shared data set, and completes three variants (Three directions; Same data, different designs)", async () => {
    const { generation, variants: rows, versions: made } = await generate("Review and release today's urgent payments before cut-off");
    expect(generation.status).toBe("done");
    expect(generation.directions?.map((direction) => direction.title)).toEqual(["Exception-first queue", "Compact approval grid", "Cut-off timeline"]);
    expect(new Set(generation.directions?.map((direction) => direction.axis)).size).toBe(3);
    expect(rows.map((row) => [row.status, row.direction?.title])).toEqual([
      ["ready", "Exception-first queue"],
      ["ready", "Compact approval grid"],
      ["ready", "Cut-off timeline"],
    ]);
    for (const version of made) {
      expect(version?.sampleData).toEqual(generation.sampleData);
      expect(version?.code).toContain('from "./data"');
      expect(version?.compiled).toContain("globalThis.__fabricatePrototype");
    }
  });

  it("records every provenance field the generation spec lists (Provenance details)", async () => {
    await connection.db.insert(lessons).values({ id: "lsn_aaaaaaaaaaaaaaaa", workspaceId, text: "Always show amounts with currency codes, right-aligned.", scope: { kind: "general" }, category: "Content", status: "active", source: "visitor", citations: [] });
    const { versions: made } = await generate("Review and release today's urgent payments before cut-off", 1);
    const provenance = made[0]!.provenance!;
    expect(provenance).toMatchObject({
      model: "mock",
      intent: "Review and release today's urgent payments before cut-off",
      message: null,
      scope: "page",
      direction: { title: "Exception-first queue", axis: "information hierarchy" },
      lessons: [{ id: "lsn_aaaaaaaaaaaaaaaa", text: "Always show amounts with currency codes, right-aligned." }],
      saltRelease: registryRelease().release,
      registryRelease: registryRelease().release,
      kitVersion: KIT_VERSION,
      parentVersionId: null,
    });
    expect(provenance.personas.map((persona) => persona.id)).toEqual([approver]);
    expect(provenance.saltGuidance).toEqual([{ tool: "get_component", query: "Table", entries: ["Table"] }]);
    expect(Date.parse(provenance.createdAt)).not.toBeNaN();
    const [lesson] = await connection.db.select().from(lessons).where(eq(lessons.id, "lsn_aaaaaaaaaaaaaaaa"));
    expect(lesson?.appliedCount).toBe(1);
  });

  it("repairs a variant that fails the typecheck, keeping its first-pass result (Repaired on the second attempt)", async () => {
    const { variants: rows, versions: made } = await generate("Review and release urgent payments #mock-fail-once", 1);
    expect(rows[0]?.status).toBe("ready");
    const version = made[0]!;
    expect(version.attempts.map((attempt) => attempt.passed)).toEqual([false, true]);
    expect(version.firstPass?.find((gate) => gate.gate === "typecheck")?.status).toBe("failed");
    expect(version.attempts[0]?.signatures).toEqual(["typecheck:TS2322:Button.size"]);
    expect(version.gatesPassed).toBe(true);
  });

  it("ends a variant that fails every attempt as Failed with the remaining errors, and the others finish (Repair limit reached)", async () => {
    const { generation, variants: rows, versions: made } = await generate("Review and release urgent payments #mock-fail-variant-2", 3);
    expect(rows.map((row) => row.status)).toEqual(["ready", "failed", "ready"]);
    expect(rows[1]?.failure).toMatchObject({ kind: "checks", message: "The checks still failed after 3 repairs." });
    expect(rows[1]?.failure?.issues?.[0]).toMatchObject({ code: "TS2322", symbol: "Button.size" });
    expect(made[1]?.attempts).toHaveLength(4);
    expect(made[1]?.status).toBe("failed");
    expect(generation.status).toBe("done");
    const [row] = await connection.db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
    expect(row?.variantsToday).toBe(3 + 3);
  });

  it("fails every variant with an actionable reason when the model service fails", async () => {
    const { generation, variants: rows } = await generate("Review and release urgent payments #mock-model-error", 2);
    expect(rows.map((row) => row.failure?.kind)).toEqual(["model", "model"]);
    expect(rows[0]?.failure?.message).toContain("The model service failed");
    expect(generation.status).toBe("failed");
  });

  describe("persona-fit review", () => {
    it("scores each persona, records the reviewing model, and averages known scores", async () => {
      const { versions: made } = await generate("Review and release today's urgent payments before cut-off", 1);
      const fit = made[0]!.fit!;
      expect(fit).toMatchObject({ status: "reviewed", model: "mock" });
      expect(fit.personas.map((persona) => persona.personaId)).toEqual([approver]);
      expect(fit.personas[0]?.checks).toHaveLength(3);
      expect(made[0]?.fitAverage).toBeCloseTo(4.29, 2);
    });

    it("shows not applicable for a version with no persona, without calling a model (No persona)", async () => {
      const { versions: made } = await generate("Review and release today's urgent payments before cut-off", 1, []);
      expect(made[0]?.fit).toMatchObject({ status: "not-applicable", model: null, average: null });
    });

    it("leaves Unknown out of the average (Unknown score)", () => {
      const review = (scores: (1 | 2 | 3 | 4 | 5 | "unknown")[]): PersonaReview => ({
        personaId: "per_aaaaaaaaaaaaaaaa",
        personaName: "Maya",
        criteria: { intent: { score: scores[0]!, reason: "" }, goals: { score: scores[1]!, reason: "" }, constraints: { score: scores[2]!, reason: "" }, clarity: { score: scores[3]!, reason: "" } },
        checks: [],
        strengths: [],
        gaps: [],
      });
      expect(averageFit([review([4, "unknown", 5, 3])])).toBe(4);
      expect(averageFit([review(["unknown", "unknown", "unknown", "unknown"])])).toBeNull();
    });
  });
});
