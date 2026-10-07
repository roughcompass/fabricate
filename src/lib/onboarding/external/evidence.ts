import { type JsonObject, dump, sha256 } from "@repo-facts/contract";
import { and, desc, eq } from "drizzle-orm";
import type { Executor } from "@/lib/db/client";
import { type ObservationOutcome, type ReadOutcome, externalObservations, externalReads } from "@/lib/db/schema";
import { PROJECTIONS, canonicalize } from "../documents";
import { PINNED_CONTRACTS } from "./contracts";
import type { ExternalReference } from "./references";

/*
 * Observations of Studio and CDaaS (design decisions 7 and 8). Each read is
 * kept. What it found is stored once per distinct state, as a canonical
 * projection with the digest of the contract it was read under, so
 * identical reads share an observation and the history still shows every
 * read. A read that fails records why and never stands for absence: the
 * last observation stays, and is reported as stale.
 */

/** How long an observation counts as current. Older evidence is Stale. */
export const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

export type ReadResult =
  | { outcome: "found"; projection: unknown }
  | { outcome: "not_found" }
  | { outcome: "incompatible"; error: string }
  | { outcome: "unavailable"; error: string };

export type Observation = typeof externalObservations.$inferSelect;
export type Read = typeof externalReads.$inferSelect;

/**
 * Records one read of +reference+. A found resource's response is kept only
 * as its projection; one that doesn't fit the projection's schema is
 * recorded as incompatible. Returns the read and the observation it made.
 */
export function recordRead(db: Executor, reference: ExternalReference, result: ReadResult, options: { contractDigest?: string; readAt?: Date } = {}): { read: Read; observation: Observation | null } {
  const readAt = options.readAt ?? new Date();
  const contractDigest = options.contractDigest ?? PINNED_CONTRACTS[reference.system].digest;
  let outcome: ReadOutcome = result.outcome;
  let error = result.outcome === "unavailable" || result.outcome === "incompatible" ? result.error.slice(0, 500) : null;
  let projection: string | null = null;
  let projectionDigest = sha256(dump({ outcome }));
  if (result.outcome === "found") {
    const parsed = PROJECTIONS[reference.resourceType].safeParse(result.projection);
    if (parsed.success) {
      const canonical = canonicalize(PROJECTIONS[reference.resourceType] as never, parsed.data);
      projection = canonical.text;
      projectionDigest = canonical.digest;
    } else {
      outcome = "incompatible";
      error = `The response didn't match the ${reference.resourceType.replace("_", " ")} projection: ${parsed.error.issues[0]!.path.join(".") || "document"}`;
      projectionDigest = sha256(dump({ outcome }));
    }
  }

  let observation: Observation | null = null;
  if (outcome !== "unavailable") {
    const state = { referenceId: reference.id, outcome: outcome as ObservationOutcome, contractDigest, projectionDigest };
    observation =
      db
        .select()
        .from(externalObservations)
        .where(and(eq(externalObservations.referenceId, state.referenceId), eq(externalObservations.outcome, state.outcome), eq(externalObservations.contractDigest, contractDigest), eq(externalObservations.projectionDigest, projectionDigest)))
        .get() ?? db.insert(externalObservations).values({ ...state, projection, firstObservedAt: readAt }).returning().get();
  }
  const read = db.insert(externalReads).values({ referenceId: reference.id, observationId: observation?.id ?? null, outcome, error, readAt }).returning().get();
  return { read, observation };
}

export interface Evidence {
  reference: ExternalReference;
  /** The latest read, which may have failed. */
  lastRead: Read | null;
  /** The latest observation, and when a read last made it. */
  observation: (Observation & { observedAt: Date; projectionValue: JsonObject | null }) | null;
  /** True when the observation is older than the limit, or reads have failed since it. */
  stale: boolean;
  /** True when the observation was read under a contract other than the pinned one. */
  contractDrift: boolean;
}

/** What's known about a reference now: its latest read and latest observation. */
export function evidenceOf(db: Executor, reference: ExternalReference, now = new Date(), staleAfterMs = STALE_AFTER_MS): Evidence {
  const lastRead = db.select().from(externalReads).where(eq(externalReads.referenceId, reference.id)).orderBy(desc(externalReads.readAt), desc(externalReads.id)).limit(1).get() ?? null;
  const observed = db
    .select({ read: externalReads, observation: externalObservations })
    .from(externalReads)
    .innerJoin(externalObservations, eq(externalObservations.id, externalReads.observationId))
    .where(eq(externalReads.referenceId, reference.id))
    .orderBy(desc(externalReads.readAt), desc(externalReads.id))
    .limit(1)
    .get();
  if (!observed) return { reference, lastRead, observation: null, stale: false, contractDrift: false };
  const observation = { ...observed.observation, observedAt: observed.read.readAt, projectionValue: observed.observation.projection ? (JSON.parse(observed.observation.projection) as JsonObject) : null };
  const failedSince = lastRead !== null && lastRead.id !== observed.read.id && lastRead.outcome === "unavailable";
  return {
    reference,
    lastRead,
    observation,
    stale: failedSince || now.getTime() - observation.observedAt.getTime() > staleAfterMs,
    contractDrift: observation.contractDigest !== PINNED_CONTRACTS[reference.system].digest,
  };
}

/** Every read of a reference, newest first, with what each observed. */
export function readHistory(db: Executor, referenceId: number, limit = 50) {
  return db
    .select({ read: externalReads, observation: externalObservations })
    .from(externalReads)
    .leftJoin(externalObservations, eq(externalObservations.id, externalReads.observationId))
    .where(eq(externalReads.referenceId, referenceId))
    .orderBy(desc(externalReads.readAt), desc(externalReads.id))
    .limit(limit)
    .all();
}
