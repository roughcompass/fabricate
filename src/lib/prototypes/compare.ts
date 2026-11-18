import { and, desc, eq, or } from "drizzle-orm";
import type { PrototypesExecutor } from "./db/client";
import { pairwiseReviews, versions } from "./db/schema";
import { type FileDiff, diffFile } from "./diff";
import { type KeptVersion, type Prototype, getPrototype, versionsOf } from "./prototypes";
import { CRITERIA, type CriterionId, type FitReview, type PairwiseVerdict } from "./types";

/**
 * Comparing two versions (versions spec, "Two versions can be compared side
 * by side"): any two versions of one prototype, or a version and the one its
 * fork came from. The compare page addresses versions by number, and the
 * fork's origin as "origin".
 */

export const ORIGIN = "origin";

export interface CompareSide {
  /** The value that picks it: its number, or "origin". */
  readonly key: string;
  readonly label: string;
  readonly version: KeptVersion;
  readonly prototypeName: string;
}

export interface PairwiseResult {
  readonly id: string;
  readonly status: "running" | "done" | "failed";
  readonly model: string;
  /** Winners as the compare page shows the pair: "a" is the left version. */
  readonly verdicts: readonly PairwiseVerdict[];
  readonly error: string | null;
}

export interface Comparison {
  readonly prototype: Prototype;
  readonly choices: readonly { readonly value: string; readonly label: string }[];
  readonly a: CompareSide;
  readonly b: CompareSide;
  readonly diffs: readonly FileDiff[];
  readonly review: PairwiseResult | null;
}

/** A version's average score on each criterion, over the personas with a known score; null when none is known. */
export function criterionScores(fit: FitReview | null): Record<CriterionId, number | null> {
  return Object.fromEntries(
    CRITERIA.map(({ id }) => {
      const known = (fit?.personas ?? []).flatMap((persona) => {
        const score = persona.criteria[id]?.score;
        return typeof score === "number" ? [score] : [];
      });
      return [id, known.length ? Math.round((known.reduce((sum, score) => sum + score, 0) / known.length) * 10) / 10 : null];
    }),
  ) as Record<CriterionId, number | null>;
}

/** Which side scores higher on each criterion; null on a tie or when either score is unknown. */
export function higherScores(a: FitReview | null, b: FitReview | null): Record<CriterionId, "a" | "b" | null> {
  const left = criterionScores(a);
  const right = criterionScores(b);
  return Object.fromEntries(CRITERIA.map(({ id }) => [id, left[id] === null || right[id] === null || left[id] === right[id] ? null : left[id]! > right[id]! ? "a" : "b"])) as Record<CriterionId, "a" | "b" | null>;
}

/** The versions a prototype's compare page can choose from: its own, then the one its fork came from. */
async function sidesOf(db: PrototypesExecutor, workspaceId: string, prototype: Prototype): Promise<CompareSide[]> {
  const own = (await versionsOf(db, prototype.id)).filter((version) => version.status === "ready");
  const sides: CompareSide[] = own.map((version) => ({ key: String(version.number), label: `v${version.number}`, version, prototypeName: prototype.name }));
  const forkedFrom = own[0]?.number === 1 ? own[0].provenance?.forkedFrom : null;
  if (forkedFrom) {
    const [origin] = await db
      .select()
      .from(versions)
      .where(and(eq(versions.workspaceId, workspaceId), eq(versions.id, forkedFrom.versionId)));
    if (origin?.prototypeId && origin.number !== null && origin.status === "ready") sides.push({ key: ORIGIN, label: `${forkedFrom.prototypeName} v${forkedFrom.number} (fork origin)`, version: origin as KeptVersion, prototypeName: forkedFrom.prototypeName });
  }
  return sides;
}

/** The latest pairwise review of the pair, in either order, with its winners as the page shows the pair. */
async function latestReview(db: PrototypesExecutor, workspaceId: string, a: string, b: string): Promise<PairwiseResult | null> {
  const [review] = await db
    .select()
    .from(pairwiseReviews)
    .where(and(eq(pairwiseReviews.workspaceId, workspaceId), or(and(eq(pairwiseReviews.versionAId, a), eq(pairwiseReviews.versionBId, b)), and(eq(pairwiseReviews.versionAId, b), eq(pairwiseReviews.versionBId, a)))))
    .orderBy(desc(pairwiseReviews.createdAt))
    .limit(1);
  if (!review) return null;
  const swapped = review.versionAId !== a;
  const flip = (winner: PairwiseVerdict["winner"]) => (!swapped || winner === "undecided" ? winner : winner === "a" ? "b" : "a");
  return { id: review.id, status: review.status, model: review.model, verdicts: (review.verdicts ?? []).map((verdict) => ({ ...verdict, winner: flip(verdict.winner) })), error: review.error?.message ?? null };
}

/**
 * The comparison the address asks for, or null when the prototype has
 * nothing to compare. Without a choice, it compares the latest version with
 * the one before it, or with the fork's origin.
 */
export async function loadComparison(db: PrototypesExecutor, workspaceId: string, prototypeId: string, aKey: string | undefined, bKey: string | undefined): Promise<Comparison | null> {
  const prototype = await getPrototype(db, workspaceId, prototypeId);
  const sides = await sidesOf(db, workspaceId, prototype);
  if (sides.length < 2) return null;
  const mine = sides.filter((side) => side.key !== ORIGIN);
  const latest = mine.at(-1)!;
  const fallbackA = mine.length > 1 ? mine.at(-2)! : sides.find((side) => side.key === ORIGIN)!;
  let a = sides.find((side) => side.key === aKey) ?? fallbackA;
  let b = sides.find((side) => side.key === bKey) ?? latest;
  if (a.key === b.key) [a, b] = a.key === latest.key ? [fallbackA, latest] : [a, latest];
  const diffs = [diffFile("Prototype.tsx", a.version.code, b.version.code), diffFile("data.ts", a.version.sampleData?.source ?? "", b.version.sampleData?.source ?? ""), ...(a.version.styles || b.version.styles ? [diffFile("Prototype.module.css", a.version.styles ?? "", b.version.styles ?? "")] : [])];
  return { prototype, choices: sides.map((side) => ({ value: side.key, label: side.label })), a, b, diffs, review: await latestReview(db, workspaceId, a.version.id, b.version.id) };
}
