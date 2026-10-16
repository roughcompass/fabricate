import { generateText, Output } from "ai";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { NotFoundError } from "@/lib/db/errors";
import { generatePublicId } from "@/lib/db/ids";
import { type PrototypesSettings, getConfig } from "@/lib/config";
import type { PrototypesExecutor } from "../db/client";
import { pairwiseReviews, prototypes, versions } from "../db/schema";
import { gatewayOptions, modelFor } from "../models";
import type { PairwiseVerdict, PersonaCopy } from "../types";
import { claimVariants } from "../workspace";
import { failureFrom } from "./errors";
import { pairwisePrompt } from "./prompts";

/**
 * The pairwise review (quality-checks spec, "Two versions can be judged
 * pairwise on request"; design.md, decision 10). The review model judges the
 * pair twice, with A and B swapped; where the two runs disagree, the verdict
 * is Undecided, which corrects for a judge's preference for one position.
 */

const PAIRWISE_TIMEOUT_MS = 120_000;
const verdictSchema = z.object({
  verdicts: z.array(z.object({ personaId: z.string().nullable(), personaName: z.string(), winner: z.enum(["a", "b", "undecided"]), reasons: z.array(z.string().max(300)).max(4) })),
});

export interface PairSide {
  readonly number: number;
  /** What the page calls it, such as "v3"; defaults to its number. */
  readonly name?: string;
  readonly code: string;
}

/** Judges A against B in both orders, for each persona. */
export async function judgePair(intent: string, personas: readonly PersonaCopy[], a: PairSide, b: PairSide, settings: PrototypesSettings = getConfig().prototypes): Promise<PairwiseVerdict[]> {
  const { model } = modelFor("review", settings);
  const run = (first: PairSide, second: PairSide) =>
    generateText({ model, output: Output.object({ schema: verdictSchema }), prompt: pairwisePrompt(intent, personas, { label: "A", ...first }, { label: "B", ...second }), providerOptions: gatewayOptions(settings), timeout: PAIRWISE_TIMEOUT_MS }).then((result) => result.output.verdicts);
  const [forward, swapped] = await Promise.all([run(a, b), run(b, a)]);
  const people = personas.length ? personas.map((persona) => ({ personaId: persona.id as string | null, personaName: persona.name })) : [{ personaId: null, personaName: "The intent" }];
  return people.map((person) => {
    const find = (verdicts: typeof forward) => verdicts.find((verdict) => verdict.personaId === person.personaId) ?? verdicts.find((verdict) => verdict.personaName === person.personaName) ?? verdicts[0];
    const one = find(forward);
    const two = find(swapped);
    // The swapped run calls the first version "b".
    const back = two?.winner === "a" ? "b" : two?.winner === "b" ? "a" : "undecided";
    const winner = one && two && one.winner !== "undecided" && one.winner === back ? one.winner : "undecided";
    return { ...person, winner, reasons: winner === "undecided" ? [...(one?.reasons ?? []), ...(two?.reasons ?? [])].slice(0, 4) : (one?.reasons ?? []) };
  });
}

/** Starts a pairwise review of two versions of one prototype, or a version and the one its fork came from; it counts toward the daily limit. */
export async function startPairwise(db: PrototypesExecutor, workspaceId: string, versionAId: string, versionBId: string, settings: PrototypesSettings = getConfig().prototypes, now = new Date()): Promise<string> {
  const rows = await db.select({ id: versions.id, status: versions.status }).from(versions).where(and(eq(versions.workspaceId, workspaceId)));
  for (const id of [versionAId, versionBId]) if (rows.find((row) => row.id === id)?.status !== "ready") throw new NotFoundError("Unknown version");
  const id = generatePublicId("pwr");
  await db.transaction(async (tx) => {
    await claimVariants(tx, workspaceId, 1, settings.dailyVariantLimit, now);
    await tx.insert(pairwiseReviews).values({ id, workspaceId, versionAId, versionBId, model: settings.models.review, createdAt: now });
  });
  return id;
}

/** Runs a started pairwise review and stores its verdicts. */
export async function runPairwise(db: PrototypesExecutor, reviewId: string, settings: PrototypesSettings = getConfig().prototypes): Promise<void> {
  const [review] = await db.select().from(pairwiseReviews).where(eq(pairwiseReviews.id, reviewId));
  if (!review || review.status !== "running") return;
  const [a] = await db.select().from(versions).where(eq(versions.id, review.versionAId));
  const [b] = await db.select().from(versions).where(eq(versions.id, review.versionBId));
  if (!a?.provenance || !b?.provenance) {
    await db.update(pairwiseReviews).set({ status: "failed", error: { kind: "internal", message: "A version in the pair no longer exists." } }).where(eq(pairwiseReviews.id, reviewId));
    return;
  }
  try {
    // A version and its fork's origin are in different prototypes, so their names say which.
    const names = a.prototypeId !== b.prototypeId ? await db.select({ id: prototypes.id, name: prototypes.name }).from(prototypes).where(inArray(prototypes.id, [a.prototypeId ?? "", b.prototypeId ?? ""])) : [];
    const name = (version: typeof a) => `${names.find((entry) => entry.id === version.prototypeId)?.name.concat(" ") ?? ""}v${version.number ?? 0}`;
    const verdicts = await judgePair(a.provenance.intent, a.provenance.personas, { number: a.number ?? 0, name: name(a), code: a.code }, { number: b.number ?? 0, name: name(b), code: b.code }, settings);
    await db.update(pairwiseReviews).set({ status: "done", verdicts }).where(eq(pairwiseReviews.id, reviewId));
  } catch (error) {
    await db.update(pairwiseReviews).set({ status: "failed", error: failureFrom(error) }).where(eq(pairwiseReviews.id, reviewId));
  }
}
