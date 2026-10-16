import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { getConfig } from "@/lib/config";
import { generatePublicId } from "@/lib/db/ids";
import type { PrototypesExecutor } from "../db/client";
import { benchmarkIntents, pageShells, personas, workspaces } from "../db/schema";
import { DEFAULT_SHELL, SEED_BENCHMARKS, SEED_PERSONAS, type SeedPersona } from "./defaults";
import { SEED_FORMAT, type WorkspaceSeed, importWorkspaceSeed } from "./workspace-seed";

/**
 * Seeds a new workspace (prototypes/availability spec, "Each workspace starts
 * with seeded examples") inside the transaction that created it, with fresh
 * ids, so seeded content is identical in every workspace and viewing it never
 * calls a model. With the examples setting on, the workspace is a copy of the
 * rehearsed one in seed.json: personas, shell, benchmark intents, prototypes,
 * feedback, lessons, progress, and a lesson check. With it off, as in tests,
 * it gets only the five personas, the default shell, and the benchmark intents.
 */

export const SEED_FILE = path.join(/*turbopackIgnore: true*/ process.cwd(), "src", "lib", "prototypes", "seed", "seed.json");

let cached: WorkspaceSeed | null | undefined;

/** The committed seed, read once; null when there isn't one. */
export function committedSeed(): WorkspaceSeed | null {
  if (cached !== undefined) return cached;
  try {
    const seed = JSON.parse(fs.readFileSync(SEED_FILE, "utf8")) as WorkspaceSeed;
    cached = seed.format === SEED_FORMAT ? seed : null;
  } catch {
    cached = null;
  }
  return cached;
}

export async function seedWorkspace(tx: PrototypesExecutor, workspaceId: string, now = new Date(), examples = getConfig().prototypes.examples): Promise<void> {
  const seed = examples ? committedSeed() : null;
  if (seed) return importWorkspaceSeed(tx, workspaceId, seed);
  const personaIds = new Map<SeedPersona["key"], string>();
  for (const persona of SEED_PERSONAS) personaIds.set(persona.key, generatePublicId("per"));
  await tx.insert(personas).values(
    // A millisecond apart, so the library lists them in the order they are defined.
    SEED_PERSONAS.map(({ key, ...fields }, index) => ({ ...fields, goals: [...fields.goals], constraints: [...fields.constraints], id: personaIds.get(key)!, workspaceId, example: true, createdAt: new Date(now.getTime() + index), updatedAt: now })),
  );
  await tx.insert(pageShells).values({ workspaceId, config: DEFAULT_SHELL, updatedAt: now });
  await tx.insert(benchmarkIntents).values(
    SEED_BENCHMARKS.map((benchmark, position) => ({ id: generatePublicId("bmi"), workspaceId, position, intent: benchmark.intent, scope: benchmark.scope, personaIds: benchmark.personas.map((key) => personaIds.get(key)!), updatedAt: now })),
  );
  await tx.update(workspaces).set({ personaCount: SEED_PERSONAS.length }).where(eq(workspaces.id, workspaceId));
}
