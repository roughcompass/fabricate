import fs from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { type FrontendRegistryConfig, getConfig } from "@/lib/config";
import { type Executor, immediate } from "@/lib/db/client";
import { NotFoundError } from "@/lib/db/errors";
import { generatePublicId } from "@/lib/db/ids";
import { type MockBodyMode, type MockQueryMode, mockSetImports, mockSets } from "@/lib/db/schema";
import { applicationDefault, setApplicationDefault } from "./defaults";
import { checkRule, checkSet } from "./checks";
import { EXPORT_ORIGIN } from "./export";
import { type DraftRule, type HostsSuggestion, groupCalls } from "./group";
import { type LeftOut, readHar } from "./har-import";
import { type HostMapping, type MockSet, type RuleInput, type StoredBody, toMockSet } from "./model";
import { appendRules, getSet, insertSet } from "./records";
import { type Removed, addRemoved, noneRemoved, sanitizeCall } from "./sanitize";
import { copyBody, discardDirectory, importDirectory, removeUnusedBodies, setDirectory, writeAtomically, writeBody } from "./storage";

/*
 * Drafts of HAR uploads (add-mock-sets, design decision 12, steps 8 to 10;
 * mock-set-import spec). An upload's calls are read, sanitized, and grouped
 * into rules before anything is written; the draft keeps only those, as
 * `calls.json` with their bodies beside it under `.mock-imports/<import>/`,
 * and a row holding the review's choices. Only the workspace that uploaded
 * a draft can read it, for 24 hours. Saving moves the checked rules into a
 * new or existing set in one transaction, within the limits; cancelling
 * deletes it.
 */

/** How long a draft is kept. */
export const DRAFT_HOURS = 24;
/**
 * Calls the review lists on a page.
 * @public Review HAR uses this (add-mock-sets, task 5.5).
 */
export const REVIEW_PAGE_SIZE = 50;

const CALLS_FILE = "calls.json";

/** A rule of a draft as `calls.json` stores it, its bodies by digest. */
export interface DraftCall {
  /** Names it in the review's checkboxes and the draft's `unchecked`. */
  readonly key: string;
  readonly method: string;
  readonly origin: string;
  readonly pattern: string;
  readonly queryMode: MockQueryMode;
  readonly query: readonly [string, string][];
  readonly queryIgnored: readonly string[];
  readonly bodyMode: MockBodyMode;
  readonly body: StoredBody | null;
  readonly responses: readonly { readonly status: number; readonly headers: readonly [string, string][]; readonly body: StoredBody | null; readonly latencyMs: number }[];
  readonly calls: number;
  readonly dropped: number;
  readonly removed: Removed;
  readonly binary: boolean;
  readonly enabled: boolean;
  /** The bytes of its distinct bodies. */
  readonly size: number;
}

/** What `calls.json` holds. */
export interface DraftContents {
  readonly calls: readonly DraftCall[];
  readonly leftOut: readonly LeftOut[];
  readonly beyondLimit: number;
  readonly removed: Removed;
  readonly hosts: HostsSuggestion;
}

export interface Draft {
  readonly id: number;
  readonly publicId: string;
  readonly applicationId: number;
  readonly fileName: string;
  readonly entryCount: number;
  /** The set it adds to, or null for a new one. */
  readonly target: MockSet | null;
  readonly setName: string | null;
  readonly unchecked: readonly string[];
  readonly hosts: { readonly mode: "any" | "mapped"; readonly map: readonly HostMapping[] } | null;
  readonly makeDefault: boolean | null;
  readonly fromOnboarding: boolean;
  readonly createdAt: Date;
  readonly expiresAt: Date;
}

/** Raised for a draft past its 24 hours: its address says to upload the file again. */
export class DraftExpiredError extends NotFoundError {
  constructor() {
    super("This upload expired after 24 hours. Upload the HAR file again.");
  }
}

function toDraft(db: Executor, row: typeof mockSetImports.$inferSelect): Draft {
  const target = row.targetSetId === null ? null : db.select().from(mockSets).where(eq(mockSets.id, row.targetSetId)).get();
  return {
    id: row.id,
    publicId: row.publicId,
    applicationId: row.applicationId,
    fileName: row.fileName,
    entryCount: row.entryCount,
    target: target ? toMockSet(target) : null,
    setName: row.setName,
    unchecked: row.unchecked,
    hosts: row.hosts as Draft["hosts"],
    makeDefault: row.makeDefault,
    fromOnboarding: row.fromOnboarding,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
  };
}

/** Stores a draft rule's bodies by digest in +directory+, and returns the rule as `calls.json` holds it. */
function storedCall(directory: string, rule: DraftRule, key: string): DraftCall {
  const sizes = new Map<string, number>();
  const store = (body: DraftRule["body"]): StoredBody | null => {
    if (!body) return null;
    const { digest, size } = writeBody(directory, body.bytes);
    sizes.set(digest, size);
    return { digest, size, type: body.type };
  };
  const body = store(rule.body);
  const responses = rule.responses.map((response) => ({ status: response.status, headers: response.headers, body: store(response.body), latencyMs: response.latencyMs }));
  const { body: _body, responses: _responses, ...rest } = rule;
  return { ...rest, key, body, responses, size: [...sizes.values()].reduce((sum, size) => sum + size, 0) };
}

export interface NewDraft {
  readonly applicationId: number;
  readonly workspaceId: number;
  readonly fileName: string;
  /** The set to add to, by its public ID, or null for a new one. */
  readonly target: string | null;
  readonly setName: string | null;
  readonly fromOnboarding: boolean;
}

/**
 * Reads, sanitizes, and groups the HAR file +source+, and keeps the result
 * as a draft for the review: nothing unsanitized is written. Binary bodies
 * start unchecked. Throws HarFormatError for a file that isn't a HAR, and
 * NotFoundError for a target set of another application.
 */
export function createDraft(db: Executor, input: NewDraft, source: string, config: FrontendRegistryConfig = getConfig(), now = new Date()): Draft {
  const target = input.target ? getSet(db, input.applicationId, input.target) : null;
  const read = readHar(source);
  const sanitized = read.calls.map(sanitizeCall);
  const { rules, hosts } = groupCalls(sanitized);
  const removed = noneRemoved();
  for (const call of sanitized) addRemoved(removed, call.removed);
  const publicId = generatePublicId("mki");
  const directory = importDirectory(config, publicId);
  try {
    const calls = rules.map((rule, index) => storedCall(directory, rule, `c${index + 1}`));
    const contents: DraftContents = { calls, leftOut: read.leftOut, beyondLimit: read.beyondLimit, removed, hosts };
    writeAtomically(path.join(directory, CALLS_FILE), JSON.stringify(contents));
    const row = db
      .insert(mockSetImports)
      .values({
        publicId,
        applicationId: input.applicationId,
        workspaceId: input.workspaceId,
        targetSetId: target?.id ?? null,
        fileName: path.basename(input.fileName || "upload.har").slice(0, 255),
        entryCount: Math.min(read.entryCount, 5000),
        setName: input.setName?.trim().slice(0, 60) || null,
        unchecked: calls.filter((call) => call.binary).map((call) => call.key),
        hosts: target ? null : ({ mode: hosts.mode, map: hosts.mode === "mapped" ? hosts.origins.map(({ origin }) => ({ from: origin, to: origin })) : [] } as never),
        makeDefault: null,
        fromOnboarding: input.fromOnboarding,
        createdAt: now,
        expiresAt: new Date(now.getTime() + DRAFT_HOURS * 3_600_000),
      })
      .returning()
      .get();
    return toDraft(db, row);
  } catch (error) {
    fs.rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

/**
 * The draft +publicId+ of the application, readable only by the workspace
 * that uploaded it: another workspace's isn't found. Throws
 * DraftExpiredError once its 24 hours are up.
 * @public Review HAR uses this (add-mock-sets, task 5.5).
 */
export function getDraft(db: Executor, applicationId: number, workspaceId: number | null, publicId: string, now = new Date()): Draft {
  const row = workspaceId === null ? undefined : db.select().from(mockSetImports).where(and(eq(mockSetImports.publicId, publicId), eq(mockSetImports.applicationId, applicationId), eq(mockSetImports.workspaceId, workspaceId))).get();
  if (!row) throw new NotFoundError("That upload isn't there. It may have been saved or cancelled.");
  if (row.expiresAt.getTime() <= now.getTime()) throw new DraftExpiredError();
  return toDraft(db, row);
}

/** What the draft's `calls.json` holds. */
export function draftContents(draft: Pick<Draft, "publicId">, config: FrontendRegistryConfig = getConfig()): DraftContents {
  return JSON.parse(fs.readFileSync(path.join(importDirectory(config, draft.publicId), CALLS_FILE), "utf8")) as DraftContents;
}

export interface ReviewChoices {
  /** The keys of the calls on the page the review showed, and which of them stayed checked. */
  readonly shown?: readonly string[];
  readonly checked?: readonly string[];
  readonly setName?: string | null;
  readonly hosts?: { readonly mode: "any" | "mapped"; readonly map: readonly HostMapping[] } | null;
  readonly makeDefault?: boolean | null;
}

/**
 * Records the review's choices so far: the page's checkboxes, the name, the hosts, and the default box.
 * @public Review HAR uses this (add-mock-sets, task 5.5).
 */
export function updateDraft(db: Executor, draft: Draft, choices: ReviewChoices): Draft {
  const shown = new Set(choices.shown ?? []);
  const checked = new Set(choices.checked ?? []);
  const unchecked = [...draft.unchecked.filter((key) => !shown.has(key)), ...[...shown].filter((key) => !checked.has(key))];
  const row = db
    .update(mockSetImports)
    .set({
      unchecked,
      ...(choices.setName !== undefined && { setName: choices.setName?.trim().slice(0, 60) || null }),
      ...(choices.hosts !== undefined && { hosts: choices.hosts as never }),
      ...(choices.makeDefault !== undefined && { makeDefault: choices.makeDefault }),
    })
    .where(eq(mockSetImports.id, draft.id))
    .returning()
    .get();
  return toDraft(db, row);
}

/** A draft call as the records take a rule, its bodies kept by digest. */
function ruleInput(call: DraftCall): RuleInput {
  const keep = (body: StoredBody | null) => (body ? { keep: body.digest, size: body.size } : null);
  return {
    method: call.method,
    // A rule written without an origin exported as mock.invalid, and reads back without one.
    origin: call.origin === EXPORT_ORIGIN ? null : call.origin,
    pattern: call.pattern,
    queryMode: call.queryMode,
    query: call.query,
    queryIgnored: call.queryIgnored,
    bodyMode: call.bodyMode,
    body: call.body ? { keep: call.body.digest, size: call.body.size, type: call.body.type } : null,
    enabled: call.enabled,
    responses: call.responses.map((response) => ({ status: response.status, headers: response.headers, contentType: response.body?.type ?? null, body: keep(response.body), latencyMs: response.latencyMs })),
  };
}

/**
 * Saves the draft: in one transaction, creates the set when it's new, adds
 * the checked calls' rules after its existing rules, moves their bodies into
 * the set's directory, sets the application's default when the box was
 * checked (by default, when it has none), and deletes the draft. A save that
 * would pass a limit changes nothing. Returns the set as it stands.
 * @public Review HAR uses this (add-mock-sets, task 5.5).
 */
export function saveDraft(db: Executor, draft: Draft, byName: string | null, config: FrontendRegistryConfig = getConfig()): MockSet {
  const contents = draftContents(draft, config);
  const unchecked = new Set(draft.unchecked);
  const chosen = contents.calls.filter((call) => !unchecked.has(call.key));
  const from = importDirectory(config, draft.publicId);
  const copied: { directory: string; digests: string[] } = { directory: "", digests: [] };
  try {
    const saved = immediate(db, (tx) => {
      const name = draft.setName ?? "";
      const set = draft.target ? getSet(tx, draft.applicationId, draft.target.publicId) : insertSet(tx, draft.applicationId, { ...checkSet({ name, hostMode: draft.hosts?.mode ?? "any", hosts: draft.hosts?.map ?? [] }), source: "har", sourceFile: draft.fileName }, byName);
      const directory = setDirectory(config, set.publicId);
      copied.directory = directory;
      for (const call of chosen) {
        for (const body of [call.body, ...call.responses.map((response) => response.body)]) {
          if (!body || fs.existsSync(path.join(directory, body.digest))) continue;
          copyBody(from, directory, body.digest);
          copied.digests.push(body.digest);
        }
      }
      const { set: touched } = appendRules(tx, set, chosen.map((call) => checkRule(ruleInput(call))), byName, config);
      const makeDefault = draft.makeDefault ?? applicationDefault(tx, draft.applicationId) === null;
      if (makeDefault) setApplicationDefault(tx, draft.applicationId, touched.publicId);
      tx.delete(mockSetImports).where(eq(mockSetImports.id, draft.id)).run();
      return touched;
    });
    discardDirectory(config, from);
    return saved;
  } catch (error) {
    // Nothing of a refused save stays: the bodies copied for it go again.
    if (copied.directory) removeUnusedBodies(copied.directory, new Set(fs.existsSync(copied.directory) ? fs.readdirSync(copied.directory).filter((name) => !copied.digests.includes(name)) : []));
    throw error;
  }
}

/**
 * Deletes the draft and its files; nothing of the upload remains.
 * @public Review HAR uses this (add-mock-sets, task 5.5).
 */
export function cancelDraft(db: Executor, draft: Pick<Draft, "id" | "publicId">, config: FrontendRegistryConfig = getConfig()): void {
  db.delete(mockSetImports).where(eq(mockSetImports.id, draft.id)).run();
  fs.rmSync(importDirectory(config, draft.publicId), { recursive: true, force: true });
}
