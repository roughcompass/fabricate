import { type JsonObject, type JsonValue, dump, sha256 } from "@repo-facts/contract";
import { type SQL, sql } from "drizzle-orm";
import { type Executor, immediate } from "@/lib/db/client";
import { NotFoundError, StaleRecordError, ValidationError } from "@/lib/db/errors";
import { CURRENT_FORMAT_VERSION, type FormatVersion, MAX_DOCUMENT_BYTES, type OnboardingSubject, type RevisionState, onboardingValidations } from "@/lib/db/schema";
import { type Actor, recordEvent } from "./attribution";
import { draftFromSubmitted } from "./formats";
import { type ValidationIssue, blockingCount, sortIssues } from "./issues";

/*
 * Revisions shared by Portals, Web Applications, and MFEs (design decision
 * 3). Each record has at most one Draft: an editable document carrying a
 * lock version. A save names the version it was based on, and a stale one is
 * refused without changing anything, so the person keeps what they entered
 * and sees that the record changed. Submitting validates the Draft as one
 * graph: with any blocking issue, only the validation result is recorded;
 * otherwise the revision is frozen with its canonical document and digest,
 * and its normalized rows are written in the same transaction. A later edit
 * starts a new Draft from the latest submitted revision, which it then
 * supersedes when it's submitted.
 *
 * Every revision names its document's format (see formats.ts). New Drafts,
 * saves, and submissions are version 2; a v1 Draft becomes version 2 the
 * next time it's saved or submitted, and a submitted v1 revision is never
 * touched.
 */

export type RevisionKind = OnboardingSubject;

const TABLES: Record<RevisionKind, { identity: string; revisions: string; key: string }> = {
  portal: { identity: "portals", revisions: "portal_revisions", key: "portal_id" },
  application: { identity: "applications", revisions: "application_revisions", key: "application_id" },
  microfrontend: { identity: "microfrontends", revisions: "microfrontend_revisions", key: "microfrontend_id" },
};

export interface Revision {
  id: number;
  number: number;
  state: RevisionState;
  /** The document's format: 1 for history written before format versions, 2 for everything since. */
  formatVersion: FormatVersion;
  lockVersion: number;
  document: JsonObject;
  digest: string | null;
  basedOnRevisionId: number | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  submittedBy: string | null;
  submittedAt: Date | null;
}

interface RevisionRow {
  id: number;
  number: number;
  state: RevisionState;
  format_version: FormatVersion;
  lock_version: number;
  document: string;
  digest: string | null;
  based_on_revision_id: number | null;
  created_by: string;
  created_at: number;
  updated_at: number;
  submitted_by: string | null;
  submitted_at: number | null;
}

/** Raised when a save or submission was based on an older version of the Draft. It keeps what was entered. */
export class StaleDraftError extends StaleRecordError {
  override name = "StaleDraftError";

  constructor(
    readonly current: Revision,
    readonly attempted: unknown,
  ) {
    super(`Revision ${current.number} changed since you opened it`);
  }
}

const columns = sql.raw("id, number, state, format_version, lock_version, document, digest, based_on_revision_id, created_by, created_at, updated_at, submitted_by, submitted_at");

function toRevision(row: RevisionRow): Revision {
  return {
    id: row.id,
    number: row.number,
    state: row.state,
    formatVersion: row.format_version,
    lockVersion: row.lock_version,
    document: JSON.parse(row.document) as JsonObject,
    digest: row.digest,
    basedOnRevisionId: row.based_on_revision_id,
    createdBy: row.created_by,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    submittedBy: row.submitted_by,
    submittedAt: row.submitted_at === null ? null : new Date(row.submitted_at),
  };
}

function select(db: Executor, kind: RevisionKind, where: SQL, order = sql.raw("number")): Revision[] {
  const table = TABLES[kind];
  return db.all<RevisionRow>(sql`select ${columns} from ${sql.identifier(table.revisions)} where ${where} order by ${order}`).map(toRevision);
}

const ofRecord = (kind: RevisionKind, identityId: number) => sql`${sql.identifier(TABLES[kind].key)} = ${identityId}`;

/** Every revision of a record, oldest first. */
export function revisionsOf(db: Executor, kind: RevisionKind, identityId: number): Revision[] {
  return select(db, kind, ofRecord(kind, identityId));
}

export function revisionById(db: Executor, kind: RevisionKind, revisionId: number): Revision | undefined {
  return select(db, kind, sql`id = ${revisionId}`)[0];
}

export function revisionByNumber(db: Executor, kind: RevisionKind, identityId: number, number: number): Revision | undefined {
  return select(db, kind, sql`${ofRecord(kind, identityId)} and number = ${number}`)[0];
}

/** The record's one editable Draft, if it has one. */
export function draftOf(db: Executor, kind: RevisionKind, identityId: number): Revision | undefined {
  return select(db, kind, sql`${ofRecord(kind, identityId)} and state = 'draft'`)[0];
}

/** The record's newest submitted revision. */
export function latestSubmitted(db: Executor, kind: RevisionKind, identityId: number): Revision | undefined {
  return select(db, kind, sql`${ofRecord(kind, identityId)} and state = 'submitted'`, sql.raw("number desc"))[0];
}

/** A document as it's stored, refused when it's larger than a stored document may be. */
function storedText(document: unknown, field = "document"): string {
  let text: string;
  try {
    text = JSON.stringify(document);
  } catch {
    throw new ValidationError([{ field, message: "The draft couldn't be saved as JSON" }]);
  }
  if (document === null || typeof document !== "object" || Array.isArray(document)) throw new ValidationError([{ field, message: "A draft is a JSON object" }]);
  if (Buffer.byteLength(text) > MAX_DOCUMENT_BYTES) throw new ValidationError([{ field, message: `The draft is larger than ${MAX_DOCUMENT_BYTES / 1024} KB` }]);
  return text;
}

/**
 * Opens the record's Draft, starting one when it has none: from the latest
 * submitted revision, converted when it's version 1, or +initial+ for a
 * record not yet submitted.
 */
export function startDraft(db: Executor, kind: RevisionKind, identityId: number, actor: Actor, initial: JsonObject = {}): Revision {
  return immediate(db, (tx) => {
    const existing = draftOf(tx, kind, identityId);
    if (existing) return existing;
    const table = TABLES[kind];
    const base = latestSubmitted(tx, kind, identityId);
    const number = revisionsOf(tx, kind, identityId).length + 1;
    const now = Date.now();
    const created = tx.get<RevisionRow>(
      sql`insert into ${sql.identifier(table.revisions)} (${sql.identifier(table.key)}, number, state, lock_version, document, based_on_revision_id, created_by, created_at, updated_at)
        values (${identityId}, ${number}, 'draft', 0, ${storedText(base ? draftFromSubmitted(kind, base) : initial)}, ${base?.id ?? null}, ${actor.name}, ${now}, ${now})
        returning ${columns}`,
    );
    tx.run(sql`update ${sql.identifier(table.identity)} set draft_revision_id = ${created.id} where id = ${identityId}`);
    recordEvent(tx, kind, identityId, { event: "draft_started", revision: number, actor });
    return toRevision(created);
  });
}

/** Saves a Draft's document, in the current format. A save based on an older version is refused, and nothing changes. */
export function saveDraft(db: Executor, kind: RevisionKind, identityId: number, input: { lockVersion: number; document: unknown }): Revision {
  return immediate(db, (tx) => {
    const draft = draftOf(tx, kind, identityId);
    if (!draft) throw new NotFoundError("This record has no Draft to save");
    if (draft.lockVersion !== input.lockVersion) throw new StaleDraftError(draft, input.document);
    const text = storedText(input.document);
    const saved = tx.get<RevisionRow | undefined>(
      sql`update ${sql.identifier(TABLES[kind].revisions)} set document = ${text}, format_version = ${CURRENT_FORMAT_VERSION}, lock_version = lock_version + 1, updated_at = ${Date.now()}
        where id = ${draft.id} and lock_version = ${input.lockVersion} returning ${columns}`,
    );
    if (!saved) throw new StaleDraftError(draftOf(tx, kind, identityId) ?? draft, input.document);
    return toRevision(saved);
  });
}

/** What a kind's submission prepares from its Draft: every issue, and how to freeze it when there are none. */
export interface SubmissionPlan {
  issues: ValidationIssue[];
  /** The canonical document to freeze. Required when nothing blocks. */
  document?: JsonObject;
  /** Normalized columns of the submitted revision row, by column name. */
  revisionColumns?: Record<string, string | number | null>;
  /** Columns of the identity row that mirror the submitted revision, by column name. */
  identityColumns?: Record<string, string | number | null>;
  /** Whether the submitted revision becomes the record's active one. A Portal's waits for activation. */
  activate: boolean;
  /** Writes the revision's normalized rows; runs before the revision is frozen. */
  freeze?: (tx: Executor, revisionId: number) => void;
  /** Runs after the revision is frozen, in the same transaction. */
  after?: (tx: Executor, revision: Revision) => void;
}

export type SubmitResult = { submitted: true; revision: Revision; issues: ValidationIssue[] } | { submitted: false; revision: Revision; issues: ValidationIssue[] };

/**
 * Validates and submits a Draft in one transaction. The validation result is
 * recorded either way; the revision is frozen, and its rows written, only
 * when no blocking issue remains.
 */
export function submitDraft(db: Executor, kind: RevisionKind, identityId: number, input: { lockVersion: number; actor: Actor; prepare: (tx: Executor, draft: Revision) => SubmissionPlan }): SubmitResult {
  return immediate(db, (tx) => {
    const draft = draftOf(tx, kind, identityId);
    if (!draft) throw new NotFoundError("This record has no Draft to submit");
    if (draft.lockVersion !== input.lockVersion) throw new StaleDraftError(draft, draft.document);
    const plan = input.prepare(tx, draft);
    const issues = sortIssues(plan.issues);
    const document = plan.document ?? draft.document;
    recordValidation(tx, kind, draft.id, document, issues);
    if (blockingCount(issues) > 0) return { submitted: false, revision: draft, issues };
    if (!plan.document) throw new Error("A submission with no blocking issue must name its canonical document");

    const table = TABLES[kind];
    // A v1 Draft is submitted as version 2: its rows are frozen in the format its revision will have.
    if (draft.formatVersion !== CURRENT_FORMAT_VERSION) tx.run(sql`update ${sql.identifier(table.revisions)} set format_version = ${CURRENT_FORMAT_VERSION}, lock_version = lock_version + 1 where id = ${draft.id}`);
    plan.freeze?.(tx, draft.id);
    const text = dump(plan.document);
    const now = Date.now();
    const assignments = Object.entries(plan.revisionColumns ?? {}).map(([column, value]) => sql`${sql.identifier(column)} = ${value}`);
    const frozen = tx.get<RevisionRow>(
      sql`update ${sql.identifier(table.revisions)} set ${sql.join(
        [sql`state = 'submitted'`, sql`document = ${text}`, sql`digest = ${sha256(text)}`, sql`submitted_by = ${input.actor.name}`, sql`submitted_at = ${now}`, sql`updated_at = ${now}`, sql`lock_version = lock_version + 1`, ...assignments],
        sql`, `,
      )} where id = ${draft.id} returning ${columns}`,
    );
    const identity = [sql`draft_revision_id = null`, ...(plan.activate ? [sql`active_revision_id = ${draft.id}`] : []), ...Object.entries(plan.identityColumns ?? {}).map(([column, value]) => sql`${sql.identifier(column)} = ${value}`)];
    tx.run(sql`update ${sql.identifier(table.identity)} set ${sql.join(identity, sql`, `)} where id = ${identityId}`);
    const revision = toRevision(frozen);
    recordEvent(tx, kind, identityId, { event: "submitted", revision: revision.number, actor: input.actor, at: new Date(now) });
    plan.after?.(tx, revision);
    return { submitted: true, revision, issues };
  });
}

/** Records one validation of a revision's document. */
export function recordValidation(db: Executor, kind: RevisionKind, revisionId: number, document: JsonValue, issues: readonly ValidationIssue[]): void {
  db.insert(onboardingValidations)
    .values({
      subject: kind,
      portalRevisionId: kind === "portal" ? revisionId : null,
      applicationRevisionId: kind === "application" ? revisionId : null,
      microfrontendRevisionId: kind === "microfrontend" ? revisionId : null,
      documentDigest: sha256(dump(document)),
      blocking: blockingCount(issues),
      issues: JSON.stringify(issues),
      evaluatedAt: new Date(),
    })
    .run();
}

/** The latest validation of a revision, with its issues. */
export function latestValidation(db: Executor, kind: RevisionKind, revisionId: number): { issues: ValidationIssue[]; evaluatedAt: Date; blocking: number } | undefined {
  const column = kind === "portal" ? "portal_revision_id" : kind === "application" ? "application_revision_id" : "microfrontend_revision_id";
  const row = db.get<{ issues: string; evaluated_at: number; blocking: number } | undefined>(
    sql`select issues, evaluated_at, blocking from onboarding_validations where ${sql.identifier(column)} = ${revisionId} order by evaluated_at desc, id desc limit 1`,
  );
  return row ? { issues: JSON.parse(row.issues) as ValidationIssue[], evaluatedAt: new Date(row.evaluated_at), blocking: row.blocking } : undefined;
}
