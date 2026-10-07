import { eq, inArray } from "drizzle-orm";
import type { FabricateConfig } from "@/lib/config";
import { type Executor, immediate } from "@/lib/db/client";
import { applicationComponents, applicationPlacements, applications, microfrontends } from "@/lib/db/schema";
import { type Job, enqueue } from "@/lib/jobs/queue";
import { NonRetryableError } from "@/lib/jobs/worker";
import { refreshApplicationReadiness } from "../applications";
import { SYSTEM_ACTOR } from "../attribution";
import { type CatalogRead, recordCatalogRead } from "../environments";
import { refreshMicrofrontendReadiness } from "../microfrontends";
import { type CdaasClient, type RequestOptions, type StudioClient, cdaasClient, studioClient } from "./clients";
import { type ReadResult, recordRead } from "./evidence";
import { type ExternalReference, type ReferenceSubject, activeReferences, referencesOf } from "./references";

/*
 * Refreshing current state (design decision 8). A worker job reads every
 * mapped Studio and CDaaS resource on a schedule, one slot at a time, and a
 * person can ask for one record's resources to be read now. Each read is
 * recorded, even when it fails, and then the readiness of the records it's
 * evidence for is checked again. A read never happens inside a validation
 * or a submission, and an unreachable system leaves its last observation in
 * place, aging toward Stale, never claiming the resource is gone. Studio's
 * environment list, the catalog Portal and Application teams select from,
 * is read on the same schedule.
 */

export const REFRESH_ONBOARDING = "onboarding.refresh";
export const REFRESH_SUBJECT = "onboarding.refresh-subject";

export interface Clients {
  studio: StudioClient;
  cdaas: CdaasClient;
}

export function clientsFor(config: Pick<FabricateConfig, "onboarding">): Clients {
  return { studio: studioClient(config), cdaas: cdaasClient(config) };
}

/** Reads one mapped resource through its system's client. */
export function readReference(clients: Clients, reference: ExternalReference, options: RequestOptions = {}): Promise<ReadResult> {
  const id = reference.externalId;
  if (reference.system === "cdaas") {
    const [appId, viewId] = id.split("/");
    return clients.cdaas.applicationView(appId!, viewId!, options);
  }
  switch (reference.resourceType) {
    case "channel":
      return clients.studio.channel(id, options);
    case "module_group":
      return clients.studio.moduleGroup(id, options);
    case "module":
      return clients.studio.module(id, options);
    case "menu":
      return clients.studio.menu(id, options);
    default:
      return clients.studio.environment(id, options);
  }
}

/**
 * Reads +reference+, records the read, and checks again the readiness of the
 * records it's evidence for. A system that isn't configured is recorded as
 * unavailable, so its evidence ages rather than vanishing.
 */
export async function refreshReference(db: Executor, config: Pick<FabricateConfig, "onboarding">, reference: ExternalReference, options: RequestOptions & { clients?: Clients; now?: Date } = {}) {
  const result = await readReference(options.clients ?? clientsFor(config), reference, options);
  const readAt = options.now ?? new Date();
  return immediate(db, (tx) => {
    const recorded = recordRead(tx, reference, result, { readAt });
    recheckReadiness(tx, subjectOf(reference), readAt);
    return recorded;
  });
}

/**
 * Reads Studio's environment list and records the read. A failed read is
 * recorded too: it leaves the catalog's list in place, now stale. Nothing is
 * read while Studio isn't configured, and the fallback set stays in use.
 */
export async function refreshEnvironmentCatalog(db: Executor, config: Pick<FabricateConfig, "onboarding">, options: RequestOptions & { clients?: Clients; now?: Date } = {}): Promise<CatalogRead | null> {
  if (config.onboarding.studio === null && !options.clients) return null;
  const result = await (options.clients ?? clientsFor(config)).studio.environments(options);
  return recordCatalogRead(db, result, { readAt: options.now ?? new Date() });
}

/** Reads every current reference of one record. A Portal's refresh reads the environment catalog too. */
export async function refreshSubject(db: Executor, config: Pick<FabricateConfig, "onboarding">, subject: ReferenceSubject, options: RequestOptions & { clients?: Clients } = {}) {
  if (subject.kind === "portal") await refreshEnvironmentCatalog(db, config, options);
  const results = [];
  for (const reference of referencesOf(db, subject)) results.push(await refreshReference(db, config, reference, options));
  return results;
}

/** Reads the environment catalog, then every current reference, one at a time. */
export async function refreshAll(db: Executor, config: Pick<FabricateConfig, "onboarding">, options: RequestOptions & { clients?: Clients } = {}): Promise<{ read: number; unavailable: number }> {
  let read = 0;
  let unavailable = 0;
  await refreshEnvironmentCatalog(db, config, options);
  for (const reference of activeReferences(db)) {
    if (options.signal?.aborted) break;
    const { read: row } = await refreshReference(db, config, reference, options);
    read++;
    if (row.outcome === "unavailable") unavailable++;
  }
  return { read, unavailable };
}

function subjectOf(reference: ExternalReference): ReferenceSubject {
  if (reference.portalId) return { kind: "portal", id: reference.portalId };
  if (reference.applicationId) return { kind: "application", id: reference.applicationId };
  if (reference.microfrontendId) return { kind: "microfrontend", id: reference.microfrontendId };
  return { kind: "placement", id: reference.placementId! };
}

/** Checks again the readiness of a record a read is evidence for, and of the Applications that depend on it. */
export function recheckReadiness(db: Executor, subject: ReferenceSubject, now = new Date()): void {
  let applicationIds: number[] = [];
  if (subject.kind === "microfrontend") {
    const mfe = db.select().from(microfrontends).where(eq(microfrontends.id, subject.id)).get();
    if (mfe) refreshMicrofrontendReadiness(db, mfe, SYSTEM_ACTOR, now);
    applicationIds = db
      .selectDistinct({ id: applications.id })
      .from(applicationComponents)
      .innerJoin(applications, eq(applications.activeRevisionId, applicationComponents.applicationRevisionId))
      .where(eq(applicationComponents.microfrontendId, subject.id))
      .all()
      .map((row) => row.id);
  } else if (subject.kind === "application") applicationIds = [subject.id];
  else if (subject.kind === "placement") applicationIds = db.select({ id: applicationPlacements.applicationId }).from(applicationPlacements).where(eq(applicationPlacements.id, subject.id)).all().map((row) => row.id);
  if (applicationIds.length === 0) return;
  for (const application of db.select().from(applications).where(inArray(applications.id, applicationIds)).all()) refreshApplicationReadiness(db, application, SYSTEM_ACTOR, now);
}

// ---------------------------------------------------------------------------
// Jobs

function slotOf(config: Pick<FabricateConfig, "onboarding">, time: Date, offset = 0): Date {
  const length = config.onboarding.refreshMinutes * 60_000;
  return new Date((Math.floor(time.getTime() / length) + offset) * length);
}

const configured = (config: Pick<FabricateConfig, "onboarding">) => config.onboarding.studio !== null || config.onboarding.cdaas !== null;

function enqueueSlot(db: Executor, slot: Date, runAfter: Date): Job {
  return enqueue(db, { kind: REFRESH_ONBOARDING, payload: { slot: slot.toISOString() }, idempotencyKey: `${REFRESH_ONBOARDING}:${slot.toISOString()}`, runAfter, maxAttempts: 1 });
}

/** Queues this slot's refresh to run now, unless it already ran, and the next slot's. Called when a worker starts. */
export function scheduleOnboardingRefresh(db: Executor, config: Pick<FabricateConfig, "onboarding">, now = new Date()): Job[] {
  if (!configured(config)) return [];
  const next = slotOf(config, now, 1);
  return [enqueueSlot(db, slotOf(config, now), now), enqueueSlot(db, next, next)];
}

/** The scheduled job: queues the next slot first, so a failure never ends the schedule, then reads everything. */
export async function runScheduledRefresh(db: Executor, config: Pick<FabricateConfig, "onboarding">, options: { signal?: AbortSignal; now?: Date; clients?: Clients } = {}): Promise<void> {
  if (!configured(config)) return;
  const next = slotOf(config, options.now ?? new Date(), 1);
  enqueueSlot(db, next, next);
  await refreshAll(db, config, options);
}

/**
 * Queues a read of one record's resources now. Asking again within the same
 * minute queues nothing more.
 */
export function requestRefresh(db: Executor, subject: ReferenceSubject & { publicId: string }, now = new Date()): Job {
  const minute = new Date(Math.floor(now.getTime() / 60_000) * 60_000).toISOString();
  return enqueue(db, { kind: REFRESH_SUBJECT, payload: { kind: subject.kind, id: subject.id }, idempotencyKey: `${REFRESH_SUBJECT}:${subject.kind}:${subject.publicId}:${minute}`, maxAttempts: 1 });
}

export async function runSubjectRefresh(db: Executor, config: Pick<FabricateConfig, "onboarding">, payload: { kind: unknown; id: unknown }, options: { signal?: AbortSignal; clients?: Clients } = {}): Promise<void> {
  const kind = String(payload.kind);
  if (kind !== "portal" && kind !== "application" && kind !== "microfrontend" && kind !== "placement") throw new NonRetryableError(`Unknown record kind ${kind}`);
  await refreshSubject(db, config, { kind, id: Number(payload.id) }, options);
}
