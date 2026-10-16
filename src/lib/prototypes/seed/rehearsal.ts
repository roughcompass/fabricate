import { and, asc, desc, eq } from "drizzle-orm";
import { type PrototypesSettings, getConfig } from "@/lib/config";
import { orchestrateGeneration, orchestrateLessonCheck, orchestratePairwise, orchestrateRefinement } from "@/workflows/prototypes/orchestrate";
import type { PrototypesExecutor } from "../db/client";
import { lessons, personas, variants, versions } from "../db/schema";
import { rateVersion } from "../feedback";
import { forkVersion } from "../fork";
import { startLessonCheck } from "../lesson-check";
import { acceptLesson } from "../lessons";
import { proposeLessons } from "../pipeline/learn";
import { startPairwise } from "../pipeline/pairwise";
import { startRefinement } from "../pipeline/refine";
import { startGeneration } from "../pipeline/start";
import type { Scope } from "../types";
import { discardVariant, keepVariant } from "../variants";

/**
 * The rehearsed workspace every visitor's starts as (design.md, decision 12;
 * availability spec, "Each workspace starts with seeded examples"). It runs
 * the real pipeline, in-process, through every step a presenter shows:
 *
 * - a payments page generated in three directions, two discarded with reasons, one kept
 * - two refinements of it, each rated with a note, whose lessons are accepted
 * - a fork of its third version, and a pairwise review of its first and third
 * - a liquidity page and an onboarding component, each kept, the page refined once
 * - a lesson check
 *
 * That is six generations of progress. scripts/capture-prototype-seeds.ts
 * runs it through AI Gateway and writes seed.json; the tests run it on the
 * scripted model.
 */

type Log = (message: string) => void;

export interface Rehearsal {
  readonly approvalsId: string;
  readonly liquidityId: string;
  readonly onboardingId: string;
  readonly forkId: string;
}

export async function rehearse(db: PrototypesExecutor, workspaceId: string, settings: PrototypesSettings = getConfig().prototypes, log: Log = () => {}): Promise<Rehearsal> {
  const people = await db.select().from(personas).where(eq(personas.workspaceId, workspaceId)).orderBy(asc(personas.createdAt));
  const persona = (role: string) => {
    const found = people.find((entry) => entry.role.toLowerCase().includes(role));
    if (!found) throw new Error(`The workspace has no persona whose role includes "${role}"`);
    return found.id;
  };

  const generate = async (intent: string, scope: Scope, personaIds: string[], count: number) => {
    log(`Generating ${count} ${scope} ${count === 1 ? "variant" : "variants"}: ${intent}`);
    const id = await startGeneration(db, workspaceId, { intent, scope, personaIds, variants: count }, settings);
    await orchestrateGeneration(id);
    const rows = await db.select().from(variants).where(eq(variants.generationId, id)).orderBy(asc(variants.position));
    const ready = rows.filter((row) => row.status === "ready");
    if (ready.length === 0) throw new Error(`No variant of "${intent}" finished: ${rows.map((row) => row.failure?.message ?? row.status).join("; ")}`);
    return ready;
  };

  const refine = async (prototypeId: string, message: string) => {
    const [latest] = await db.select().from(versions).where(eq(versions.prototypeId, prototypeId)).orderBy(desc(versions.number)).limit(1);
    log(`Refining: ${message}`);
    const id = await startRefinement(db, workspaceId, prototypeId, latest!.id, message, settings);
    await orchestrateRefinement(id);
    const [made] = await db.select().from(versions).where(and(eq(versions.generationId, id), eq(versions.status, "ready")));
    if (!made) throw new Error(`The refinement "${message}" didn't finish`);
    return made;
  };

  /** Proposes lessons from feedback and accepts every proposal, as a presenter would after reading them. */
  const learn = async (feedbackIds: string[]) => {
    await proposeLessons(db, workspaceId, feedbackIds, settings);
    const proposed = await db.select().from(lessons).where(and(eq(lessons.workspaceId, workspaceId), eq(lessons.status, "proposed")));
    for (const lesson of proposed) await acceptLesson(db, workspaceId, lesson.id);
    log(`Accepted ${proposed.length} ${proposed.length === 1 ? "lesson" : "lessons"}`);
  };

  const approver = persona("payments approver");
  const queue = await generate("Review and release today's urgent payments before cut-off", "page", [approver], 3);
  const [kept, ...others] = queue;
  const { prototypeId: approvalsId, feedbackId: keepReason } = await keepVariant(db, workspaceId, kept!.id, "Leading with what needs action is how approvers work through a queue.");
  const reasons = ["Too dense for an approver on a phone.", "Hides the cut-off times until a payment is opened."];
  const discards = await Promise.all(others.map((variant, index) => discardVariant(db, workspaceId, variant.id, reasons[index] ?? "")));
  const v1 = kept!.versionId!;
  const firstRating = await rateVersion(db, workspaceId, v1, 2, "Too many columns; the approver only needs payee, amount, cut-off, and status.");
  await learn([keepReason, ...discards, firstRating.id].filter((id): id is string => Boolean(id)));

  const v2 = await refine(approvalsId, "Show only payee, amount, cut-off, and status by default, and move the other fields into each row's details.");
  const secondRating = await rateVersion(db, workspaceId, v2.id, 4, "Better. It needs a confirm step for payments over USD 1m, naming the four-eyes rule.");
  await learn([secondRating.id]);
  const v3 = await refine(approvalsId, "Add a confirm step for payments over USD 1m that names the four-eyes approval rule.");
  await rateVersion(db, workspaceId, v3.id, 5, "");

  log("Forking version 3");
  const forkId = await forkVersion(db, workspaceId, v3.id);
  log("Judging versions 1 and 3 pairwise");
  await orchestratePairwise(await startPairwise(db, workspaceId, v1, v3.id, settings));

  const [liquidity, onboarding] = await Promise.all([
    generate("See the group's cash position across accounts and currencies by 09:00, and spot where funding is short", "page", [persona("treasurer")], 2),
    generate("Show what an onboarding case is still missing and who needs to act on it", "component", [persona("kyc")], 2),
  ]);
  const { prototypeId: liquidityId } = await keepVariant(db, workspaceId, liquidity[0]!.id, "The shortfalls are visible without scrolling.");
  const { prototypeId: onboardingId } = await keepVariant(db, workspaceId, onboarding[0]!.id, "");
  await refine(liquidityId, "Group the balances by currency and flag accounts below their minimum balance.");

  log("Running a lesson check");
  await orchestrateLessonCheck(await startLessonCheck(db, workspaceId, settings));
  return { approvalsId, liquidityId, onboardingId, forkId };
}
