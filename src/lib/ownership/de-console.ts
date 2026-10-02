import fs from "node:fs/promises";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { DE_CONSOLE_TOKEN, type DeConsoleSource, type FabricateConfig } from "@/lib/config";
import { type Executor, immediate } from "@/lib/db/client";
import { type DeConsoleReadTrigger, deConsoleReads, ownershipAssertions, ownershipSupersessions, sealApplications } from "@/lib/db/schema";
import { type OwnershipAssertion, ensureApplication, ensurePortal, labelKey, recordAssertion } from "./records";

/*
 * The DE Console import (design decision 3). The DE Console is the source of
 * record for the SEAL IDs, teams, and portals of DE Web applications. DE
 * FabLab reads its export, from a file or an HTTPS endpoint, and never writes
 * to it: every request is a GET, and a redirect is refused so the service
 * identity's token can't follow it elsewhere. A read records DE Console
 * assertions only for values that changed, and logs the attempt.
 */

export const DE_CONSOLE_FORMAT = "de-console-ownership";
export const DE_CONSOLE_VERSION = 1;
/** Larger exports are refused rather than read into memory. */
export const MAX_EXPORT_BYTES = 10 * 1024 * 1024;
const MAX_APPLICATIONS = 20_000;
/** The scheduled read waits longer than a claim, which a person is waiting on. */
export const READ_TIMEOUT_MS = { schedule: 30_000, claim: 5_000 } as const satisfies Record<DeConsoleReadTrigger, number>;

const label = (max: number) => z.string().trim().min(1).max(max);

const exportSchema = z.object({
  format: z.literal(DE_CONSOLE_FORMAT),
  version: z.literal(DE_CONSOLE_VERSION),
  exported_at: z.iso.datetime({ offset: true }).nullish(),
  applications: z
    .array(
      z.object({
        seal_id: label(64),
        name: label(200).nullish(),
        team: label(200).nullish(),
        portals: z.array(label(100)).max(100).default([]),
      }),
    )
    .max(MAX_APPLICATIONS),
});

export interface DeConsoleApplication {
  sealId: string;
  name: string | null;
  team: string | null;
  /** Portal labels, one per portal. */
  portals: string[];
}

export interface DeConsoleExport {
  exportedAt: Date | null;
  applications: DeConsoleApplication[];
}

/** A read that failed. Its message names the problem and never contains a credential or the response body. */
export class DeConsoleReadError extends Error {
  override name = "DeConsoleReadError";
}

/** Parses an export, refusing it whole if any application is invalid or listed twice. */
export function parseDeConsoleExport(value: unknown): DeConsoleExport {
  const parsed = exportSchema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    throw new DeConsoleReadError(`The export isn't in the ${DE_CONSOLE_FORMAT} v${DE_CONSOLE_VERSION} format: ${issue.path.join(".") || "document"}: ${issue.message}`);
  }
  const seen = new Set<string>();
  const applications = parsed.data.applications.map((application) => {
    if (seen.has(application.seal_id)) throw new DeConsoleReadError(`The export lists SEAL ID ${application.seal_id} more than once`);
    seen.add(application.seal_id);
    const portals = new Map<string, string>();
    for (const portal of application.portals) if (!portals.has(labelKey(portal))) portals.set(labelKey(portal), portal.replace(/\s+/g, " "));
    return { sealId: application.seal_id, name: application.name ?? null, team: application.team ?? null, portals: [...portals.values()] };
  });
  return { exportedAt: parsed.data.exported_at ? new Date(parsed.data.exported_at) : null, applications };
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
 * Records one successful read in one transaction: for each listed
 * application, a team that changed and each portal the DE Console added or
 * removed, as DE Console assertions read at +readAt+, each superseding the
 * DE Console's earlier value.
 */
export function recordDeConsoleRead(db: Executor, data: DeConsoleExport, options: { trigger: DeConsoleReadTrigger; readAt?: Date }): DeConsoleRead {
  const readAt = options.readAt ?? new Date();
  return immediate(db, (tx) => {
    const provenance = { providedBy: "DE Console", source: "de_console", readAt, recordedAt: readAt } as const;
    const applications = data.applications.map((application) => ({ application, record: ensureApplication(tx, application.sealId, application.name) }));
    const current = currentConsoleAssertions(tx, applications.map(({ record }) => record.id));
    let recorded = 0;

    for (const { application, record } of applications) {
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

    return tx
      .insert(deConsoleReads)
      .values({ trigger: options.trigger, status: "succeeded", readAt, exportedAt: data.exportedAt, applications: data.applications.length, recorded })
      .returning()
      .get();
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

/** The applications the DE Console lists: those with a current DE Console value, by SEAL ID. */
export function deConsoleApplications(db: Executor): { id: number; sealId: string; name: string | null }[] {
  const current = currentConsoleAssertions(db);
  if (current.size === 0) return [];
  return db
    .select({ id: sealApplications.id, sealId: sealApplications.sealId, name: sealApplications.name })
    .from(sealApplications)
    .where(inArray(sealApplications.id, [...current.keys()]))
    .orderBy(sealApplications.sealId)
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
