import fs from "node:fs/promises";
import { and, desc, eq, inArray, isNull, notInArray } from "drizzle-orm";
import { z } from "zod";
import { DE_CONSOLE_TOKEN, type DeConsoleSource, type FabricateConfig } from "@/lib/config";
import { type Executor, immediate } from "@/lib/db/client";
import { ValidationError } from "@/lib/db/errors";
import { generatePublicId } from "@/lib/db/ids";
import { type DeConsoleConflictReason, type DeConsoleLinkBasis, type DeConsoleReadTrigger, applications, deConsoleConflicts, deConsoleLinks, deConsoleReads, ownershipAssertions, ownershipSupersessions } from "@/lib/db/schema";
import { type Application, type OwnershipAssertion, applicationsWithSealId, createApplication, ensurePortal, findApplication, labelKey, recordAssertion } from "./records";

/*
 * The DE Console import (design decision 3). The DE Console is the source of
 * record for the SEAL IDs, teams, and portals of DE Web applications. DE
 * FabLab reads its export, from a file or an HTTPS endpoint, and never writes
 * to it: every request is a GET, and a redirect is refused so the service
 * identity's token can't follow it elsewhere. A read records DE Console
 * assertions only for values that changed, and logs the attempt.
 *
 * Version 2 of the export names each application by the DE Console's own
 * stable ID, and its SEAL ID is metadata that may repeat or be absent.
 * Version 1 names applications only by SEAL ID, so it's read as legacy
 * evidence: an entry describes the one application its SEAL ID was first
 * linked to, or the only unlinked application carrying it, or a new one when
 * none does. A SEAL ID the export lists twice, or that several unlinked
 * applications carry, can't say which application it describes: it's
 * recorded as a conflict for review, and nothing is merged.
 */

export const DE_CONSOLE_FORMAT = "de-console-ownership";
export const DE_CONSOLE_VERSIONS = [1, 2] as const;
/** Larger exports are refused rather than read into memory. */
export const MAX_EXPORT_BYTES = 10 * 1024 * 1024;
const MAX_APPLICATIONS = 20_000;
/** The scheduled read waits longer than a claim, which a person is waiting on. */
export const READ_TIMEOUT_MS = { schedule: 30_000, claim: 5_000 } as const satisfies Record<DeConsoleReadTrigger, number>;

const label = (max: number) => z.string().trim().min(1).max(max);
const portalList = z.array(label(100)).max(100).default([]);

const exportSchema = z.discriminatedUnion("version", [
  z.object({
    format: z.literal(DE_CONSOLE_FORMAT),
    version: z.literal(1),
    exported_at: z.iso.datetime({ offset: true }).nullish(),
    applications: z.array(z.object({ seal_id: label(64), name: label(200).nullish(), team: label(200).nullish(), portals: portalList })).max(MAX_APPLICATIONS),
  }),
  z.object({
    format: z.literal(DE_CONSOLE_FORMAT),
    version: z.literal(2),
    exported_at: z.iso.datetime({ offset: true }).nullish(),
    applications: z
      .array(z.object({ application_id: label(128), seal_id: label(64).nullish(), name: label(200).nullish(), team: label(200).nullish(), portals: portalList }))
      .max(MAX_APPLICATIONS),
  }),
]);

export interface DeConsoleApplication {
  /** The DE Console's own stable ID; null in a legacy version 1 export. */
  consoleId: string | null;
  sealId: string | null;
  name: string | null;
  team: string | null;
  /** Portal labels, one per portal. */
  portals: string[];
}

export interface DeConsoleExport {
  version: (typeof DE_CONSOLE_VERSIONS)[number];
  exportedAt: Date | null;
  applications: DeConsoleApplication[];
}

/** A read that failed. Its message names the problem and never contains a credential or the response body. */
export class DeConsoleReadError extends Error {
  override name = "DeConsoleReadError";
}

/** The key an entry is linked by: its stable ID, or, in a legacy export, its SEAL ID. */
export function consoleKey(application: Pick<DeConsoleApplication, "consoleId" | "sealId">): string {
  return application.consoleId !== null ? `id:${application.consoleId}` : `seal:${application.sealId}`;
}

/**
 * Parses an export, refusing it whole if any entry is invalid or a version 2
 * export lists one application ID twice. A legacy export may list a SEAL ID
 * twice: those entries are kept, and a read records them as a conflict.
 */
export function parseDeConsoleExport(value: unknown): DeConsoleExport {
  const parsed = exportSchema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    throw new DeConsoleReadError(`The export isn't in the ${DE_CONSOLE_FORMAT} v1 or v2 format: ${issue.path.join(".") || "document"}: ${issue.message}`);
  }
  const seen = new Set<string>();
  const applications = parsed.data.applications.map((entry): DeConsoleApplication => {
    const consoleId = "application_id" in entry ? entry.application_id : null;
    if (consoleId !== null) {
      if (seen.has(consoleId)) throw new DeConsoleReadError(`The export lists application ID ${consoleId} more than once`);
      seen.add(consoleId);
    }
    const portals = new Map<string, string>();
    for (const portal of entry.portals) if (!portals.has(labelKey(portal))) portals.set(labelKey(portal), portal.replace(/\s+/g, " "));
    return { consoleId, sealId: entry.seal_id ?? null, name: entry.name ?? null, team: entry.team ?? null, portals: [...portals.values()] };
  });
  return { version: parsed.data.version, exportedAt: parsed.data.exported_at ? new Date(parsed.data.exported_at) : null, applications };
}

export interface ReadOptions {
  env?: Readonly<Record<string, string | undefined>>;
  signal?: AbortSignal;
  timeoutMs?: number;
}

/** Reads and parses the export. Throws DeConsoleReadError. */
export async function readDeConsole(source: DeConsoleSource, options: ReadOptions = {}): Promise<DeConsoleExport> {
  const text = source.kind === "file" ? await readFile(source.path) : await readEndpoint(source.url, options);
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new DeConsoleReadError("The export isn't valid JSON");
  }
  return parseDeConsoleExport(json);
}

async function readFile(file: string): Promise<string> {
  try {
    const stat = await fs.stat(file);
    if (stat.size > MAX_EXPORT_BYTES) throw new DeConsoleReadError(`The export is larger than ${MAX_EXPORT_BYTES} bytes`);
    return await fs.readFile(file, "utf8");
  } catch (error) {
    if (error instanceof DeConsoleReadError) throw error;
    throw new DeConsoleReadError(`The export file couldn't be read (${(error as NodeJS.ErrnoException).code ?? "unknown error"})`);
  }
}

async function readEndpoint(url: string, options: ReadOptions): Promise<string> {
  const token = (options.env ?? process.env)[DE_CONSOLE_TOKEN]?.trim();
  const timeout = AbortSignal.timeout(options.timeoutMs ?? READ_TIMEOUT_MS.schedule);
  let response: Response;
  try {
    response = await fetch(url, {
      // The only request DE FabLab makes to the DE Console.
      method: "GET",
      headers: { accept: "application/json", ...(token && { authorization: `Bearer ${token}` }) },
      redirect: "error",
      signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
    });
  } catch (error) {
    if (timeout.aborted) throw new DeConsoleReadError("The DE Console didn't answer in time");
    const cause = (error as Error).cause as (Error & { code?: string }) | undefined;
    if (/redirect/i.test(cause?.message ?? "")) throw new DeConsoleReadError("The DE Console answered with a redirect, which isn't followed");
    throw new DeConsoleReadError(`The DE Console couldn't be reached${cause?.code ? ` (${cause.code})` : ""}`);
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new DeConsoleReadError(`The DE Console answered HTTP ${response.status}`);
  }
  if (Number(response.headers.get("content-length") ?? 0) > MAX_EXPORT_BYTES) {
    await response.body?.cancel();
    throw new DeConsoleReadError(`The export is larger than ${MAX_EXPORT_BYTES} bytes`);
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for await (const chunk of response.body ?? []) {
      size += chunk.byteLength;
      if (size > MAX_EXPORT_BYTES) throw new DeConsoleReadError(`The export is larger than ${MAX_EXPORT_BYTES} bytes`);
      chunks.push(chunk);
    }
  } catch (error) {
    if (error instanceof DeConsoleReadError) throw error;
    throw new DeConsoleReadError(timeout.aborted ? "The DE Console didn't answer in time" : "The DE Console's answer was cut off");
  }
  return Buffer.concat(chunks).toString("utf8");
}

export type DeConsoleRead = typeof deConsoleReads.$inferSelect;

/**
 * Records one successful read in one transaction: for each entry linked to
 * one application, a team that changed and each portal the DE Console added
 * or removed, as DE Console assertions read at +readAt+, each superseding the
 * DE Console's earlier value. An entry that can't be linked to one
 * application is recorded as a conflict, and its values aren't.
 */
export function recordDeConsoleRead(db: Executor, data: DeConsoleExport, options: { trigger: DeConsoleReadTrigger; readAt?: Date }): DeConsoleRead {
  const readAt = options.readAt ?? new Date();
  return immediate(db, (tx) => {
    const provenance = { providedBy: "DE Console", source: "de_console", readAt, recordedAt: readAt } as const;
    const repeated = repeatedLegacySealIds(data);
    const linked: { application: DeConsoleApplication; record: Application }[] = [];
    const conflicts: { application: DeConsoleApplication; reason: DeConsoleConflictReason; candidates: Application[] }[] = [];
    for (const application of data.applications) {
      const outcome = linkEntry(tx, application, repeated, readAt);
      if ("record" in outcome) linked.push({ application, record: outcome.record });
      else conflicts.push({ application, ...outcome });
    }
    const current = currentConsoleAssertions(tx, linked.map(({ record }) => record.id));
    let recorded = 0;

    for (const { application, record } of linked) {
      const mine = current.get(record.id) ?? [];
      const teams = mine.filter((assertion) => assertion.attribute === "team");
      if (application.team !== null && !teams.some((assertion) => assertion.valueTeam === application.team)) {
        recordAssertion(tx, { attribute: "team", application: record.id, team: application.team, ...provenance, supersedes: teams.map((assertion) => assertion.id) });
        recorded++;
      }

      const listed = new Map<number, OwnershipAssertion>();
      for (const assertion of mine) if (assertion.attribute === "portal" && !listed.has(assertion.valuePortalId!)) listed.set(assertion.valuePortalId!, assertion);
      const wanted = new Set(application.portals.map((portal) => ensurePortal(tx, portal).id));
      for (const portal of wanted) {
        if (listed.get(portal)?.operation === "add") continue;
        recordAssertion(tx, { attribute: "portal", operation: "add", application: record.id, portal, ...provenance, supersedes: listed.has(portal) ? [listed.get(portal)!.id] : [] });
        recorded++;
      }
      for (const [portal, assertion] of listed) {
        if (wanted.has(portal) || assertion.operation !== "add") continue;
        recordAssertion(tx, { attribute: "portal", operation: "remove", application: record.id, portal, ...provenance, supersedes: [assertion.id] });
        recorded++;
      }
    }

    const read = tx
      .insert(deConsoleReads)
      .values({ trigger: options.trigger, status: "succeeded", readAt, exportedAt: data.exportedAt, applications: data.applications.length, recorded })
      .returning()
      .get();
    for (const conflict of conflicts) recordConflict(tx, read, conflict);
    return read;
  });
}

/** SEAL IDs a legacy export lists more than once: those entries can't say which application they describe. */
function repeatedLegacySealIds(data: DeConsoleExport): Set<string> {
  const counts = new Map<string, number>();
  for (const application of data.applications) if (application.consoleId === null) counts.set(application.sealId!, (counts.get(application.sealId!) ?? 0) + 1);
  return new Set([...counts].filter(([, count]) => count > 1).map(([sealId]) => sealId));
}

type LinkOutcome = { record: Application } | { reason: DeConsoleConflictReason; candidates: Application[] };

/** The application an entry describes, linking it on first sight; or why it can't be told. */
function linkEntry(db: Executor, application: DeConsoleApplication, repeated: ReadonlySet<string>, readAt: Date): LinkOutcome {
  const key = consoleKey(application);
  if (application.consoleId === null && repeated.has(application.sealId!)) return { reason: "duplicate_in_export", candidates: application.sealId ? applicationsWithSealId(db, application.sealId) : [] };
  const existing = linkFor(db, key);
  if (existing) return { record: refreshMetadata(db, existing, application) };

  // A stable ID takes over its SEAL ID's legacy link, unless another stable ID already has that application.
  if (application.consoleId !== null && application.sealId) {
    const legacy = linkFor(db, `seal:${application.sealId}`);
    if (legacy && !hasConsoleId(db, legacy.id)) return { record: link(db, key, refreshMetadata(db, legacy, application), "matched", readAt) };
  }

  const linkedIds = db.select({ id: deConsoleLinks.applicationId }).from(deConsoleLinks).all().map((row) => row.id);
  const candidates = application.sealId
    ? db
        .select()
        .from(applications)
        .where(and(eq(applications.sealId, application.sealId), linkedIds.length ? notInArray(applications.id, linkedIds) : undefined))
        .orderBy(applications.id)
        .all()
    : [];
  if (candidates.length > 1) return { reason: "several_applications", candidates };
  if (candidates.length === 1) return { record: link(db, key, refreshMetadata(db, candidates[0]!, application), "matched", readAt) };
  return { record: link(db, key, createApplication(db, { sealId: application.sealId ?? null, name: application.name }), "created", readAt) };
}

function linkFor(db: Executor, key: string): Application | undefined {
  return db
    .select({ application: applications })
    .from(deConsoleLinks)
    .innerJoin(applications, eq(applications.id, deConsoleLinks.applicationId))
    .where(eq(deConsoleLinks.consoleKey, key))
    .get()?.application;
}

function hasConsoleId(db: Executor, applicationId: number): boolean {
  return db
    .select({ key: deConsoleLinks.consoleKey })
    .from(deConsoleLinks)
    .where(eq(deConsoleLinks.applicationId, applicationId))
    .all()
    .some((row) => row.key.startsWith("id:"));
}

function link(db: Executor, key: string, application: Application, basis: DeConsoleLinkBasis, linkedAt: Date, linkedBy: string | null = null): Application {
  db.insert(deConsoleLinks).values({ consoleKey: key, applicationId: application.id, basis, linkedBy, linkedAt }).run();
  return application;
}

/**
 * The DE Console is the record of a DE Web application's SEAL ID and name:
 * a version 2 entry updates them, and a legacy entry names an application
 * that has no name yet.
 */
function refreshMetadata(db: Executor, record: Application, application: DeConsoleApplication): Application {
  const changes: Partial<Pick<Application, "sealId" | "name">> = {};
  if (application.consoleId !== null && application.sealId !== record.sealId) changes.sealId = application.sealId;
  if (application.name !== null && (application.consoleId !== null ? application.name !== record.name : record.name === null)) changes.name = application.name;
  if (Object.keys(changes).length === 0) return record;
  return db.update(applications).set(changes).where(eq(applications.id, record.id)).returning().get();
}

/** Records a conflict, unless an earlier read recorded the same one. */
function recordConflict(db: Executor, read: DeConsoleRead, conflict: { application: DeConsoleApplication; reason: DeConsoleConflictReason; candidates: Application[] }): void {
  const key = consoleKey(conflict.application);
  const candidates = JSON.stringify(conflict.candidates.map((candidate) => candidate.publicId));
  const name = conflict.application.name;
  const same = db
    .select({ id: deConsoleConflicts.id })
    .from(deConsoleConflicts)
    .where(and(eq(deConsoleConflicts.consoleKey, key), eq(deConsoleConflicts.reason, conflict.reason), eq(deConsoleConflicts.candidates, candidates), name === null ? isNull(deConsoleConflicts.name) : eq(deConsoleConflicts.name, name)))
    .get();
  if (same) return;
  db.insert(deConsoleConflicts)
    .values({ publicId: generatePublicId("dcc"), readId: read.id, consoleKey: key, sealId: conflict.application.sealId, name, reason: conflict.reason, candidates, recordedAt: read.readAt })
    .run();
}

export type DeConsoleConflict = typeof deConsoleConflicts.$inferSelect;

/** The conflicts still waiting for review: the latest for each entry no link has settled since. */
export function openDeConsoleConflicts(db: Executor): DeConsoleConflict[] {
  const latest = new Map<string, DeConsoleConflict>();
  for (const conflict of db.select().from(deConsoleConflicts).orderBy(desc(deConsoleConflicts.recordedAt), desc(deConsoleConflicts.id)).all()) if (!latest.has(conflict.consoleKey)) latest.set(conflict.consoleKey, conflict);
  const settled = new Set(db.select({ key: deConsoleLinks.consoleKey }).from(deConsoleLinks).where(inArray(deConsoleLinks.consoleKey, [...latest.keys()])).all().map((row) => row.key));
  return [...latest.values()].filter((conflict) => conflict.reason === "duplicate_in_export" || !settled.has(conflict.consoleKey));
}

/**
 * Settles a conflict over which application a DE Console entry describes:
 * one of the candidates, or a new application. The next read records the
 * entry's values. A SEAL ID a legacy export lists twice can't be settled
 * here: no choice says which of its entries is which.
 */
export function resolveDeConsoleConflict(db: Executor, conflictPublicId: string, input: { application: string | null; resolvedBy: string }): Application {
  return immediate(db, (tx) => {
    const conflict = tx.select().from(deConsoleConflicts).where(eq(deConsoleConflicts.publicId, conflictPublicId)).get();
    if (!conflict) throw new ValidationError([{ field: "base", message: "That conflict doesn't exist" }]);
    if (conflict.reason === "duplicate_in_export") throw new ValidationError([{ field: "base", message: `The export lists SEAL ID ${conflict.sealId} more than once, so no choice says which entry is which` }]);
    const resolvedBy = input.resolvedBy.trim().replace(/\s+/g, " ");
    if (!resolvedBy || resolvedBy.length > 200) throw new ValidationError([{ field: "resolvedBy", message: "Enter your name or email" }]);
    if (linkFor(tx, conflict.consoleKey)) throw new ValidationError([{ field: "base", message: "This entry is already linked to an application" }]);
    const candidates = JSON.parse(conflict.candidates) as string[];
    if (input.application !== null && !candidates.includes(input.application)) throw new ValidationError([{ field: "application", message: "Choose one of the applications that carry this SEAL ID, or a new one" }]);
    const record = input.application !== null ? findApplication(tx, input.application)! : createApplication(tx, { sealId: conflict.sealId, name: conflict.name });
    return link(tx, conflict.consoleKey, record, "resolved", new Date(), resolvedBy);
  });
}

/** Records a read that failed; the error must already be free of credentials. */
export function recordFailedDeConsoleRead(db: Executor, options: { trigger: DeConsoleReadTrigger; error: string; readAt?: Date }): DeConsoleRead {
  return db
    .insert(deConsoleReads)
    .values({ trigger: options.trigger, status: "failed", readAt: options.readAt ?? new Date(), error: options.error.slice(0, 500) })
    .returning()
    .get();
}

export type RefreshResult = { status: "not_configured" } | { status: "succeeded"; read: DeConsoleRead } | { status: "failed"; read: DeConsoleRead };

/**
 * Reads the DE Console and records the result. A read that fails is logged
 * and returned, never thrown, so nothing that depends on it is blocked.
 */
export async function refreshDeConsole(db: Executor, config: FabricateConfig, trigger: DeConsoleReadTrigger, options: Omit<ReadOptions, "timeoutMs"> = {}): Promise<RefreshResult> {
  const source = config.deConsole.source;
  if (!source) return { status: "not_configured" };
  const readAt = new Date();
  let data: DeConsoleExport;
  try {
    data = await readDeConsole(source, { ...options, timeoutMs: READ_TIMEOUT_MS[trigger] });
  } catch (error) {
    if (!(error instanceof DeConsoleReadError)) throw error;
    return { status: "failed", read: recordFailedDeConsoleRead(db, { trigger, error: error.message, readAt }) };
  }
  return { status: "succeeded", read: recordDeConsoleRead(db, data, { trigger, readAt }) };
}

export interface DeConsoleStatus {
  /** When the DE Console's values were last confirmed. */
  lastSuccess: DeConsoleRead | null;
  /** The latest attempt, which may have failed since. */
  lastAttempt: DeConsoleRead | null;
}

export function deConsoleStatus(db: Executor): DeConsoleStatus {
  return {
    lastSuccess: db.select().from(deConsoleReads).where(eq(deConsoleReads.status, "succeeded")).orderBy(desc(deConsoleReads.readAt), desc(deConsoleReads.id)).limit(1).get() ?? null,
    lastAttempt: db.select().from(deConsoleReads).orderBy(desc(deConsoleReads.readAt), desc(deConsoleReads.id)).limit(1).get() ?? null,
  };
}

/** The applications the DE Console lists: those with a current DE Console value, by name and SEAL ID. */
export function deConsoleApplications(db: Executor): Pick<Application, "id" | "publicId" | "sealId" | "name">[] {
  const current = currentConsoleAssertions(db);
  if (current.size === 0) return [];
  return db
    .select({ id: applications.id, publicId: applications.publicId, sealId: applications.sealId, name: applications.name })
    .from(applications)
    .where(inArray(applications.id, [...current.keys()]))
    .orderBy(applications.name, applications.sealId, applications.id)
    .all();
}

/** The DE Console's assertions that nothing has superseded, newest first, by application. */
function currentConsoleAssertions(db: Executor, applicationIds?: readonly number[]): Map<number, OwnershipAssertion[]> {
  const filter = and(eq(ownershipAssertions.source, "de_console"), applicationIds ? inArray(ownershipAssertions.subjectApplicationId, [...applicationIds]) : undefined);
  const assertions = applicationIds?.length === 0 ? [] : db.select().from(ownershipAssertions).where(filter).orderBy(desc(ownershipAssertions.recordedAt), desc(ownershipAssertions.id)).all();
  const ids = assertions.map((assertion) => assertion.id);
  const superseded = new Set<number>();
  for (let start = 0; start < ids.length; start += 500) {
    for (const row of db.select({ id: ownershipSupersessions.supersededId }).from(ownershipSupersessions).where(inArray(ownershipSupersessions.supersededId, ids.slice(start, start + 500))).all()) superseded.add(row.id);
  }
  const result = new Map<number, OwnershipAssertion[]>();
  for (const assertion of assertions) {
    if (superseded.has(assertion.id)) continue;
    result.set(assertion.subjectApplicationId!, [...(result.get(assertion.subjectApplicationId!) ?? []), assertion]);
  }
  return result;
}
