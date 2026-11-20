import { and, asc, count, eq } from "drizzle-orm";
import { type Executor, immediate } from "@/lib/db/client";
import { IssueCollector, NotFoundError, StaleRecordError, ValidationError, isUniqueViolation } from "@/lib/db/errors";
import { generatePublicId } from "@/lib/db/ids";
import { updateLocked } from "@/lib/db/optimistic";
import { SESSION_PRESET_STORES, type SessionPresetStore, sessionPresetChoices, sessionPresets } from "@/lib/db/schema";
import { formatNumber } from "@/components/ui/count";

/*
 * Session presets (restore-toolbar-tools-and-branch-previews, design
 * decision 8; template-demo/session-presets spec): named sets of local
 * storage items, session storage items, cookies, and query parameters an
 * application starts with. They belong to the application, so every
 * workspace lists, creates, edits, and deletes the same ones; each workspace
 * only chooses which one its view starts with. They're stored as typed, in
 * plain text, and anyone who can open the application can read them.
 */

/** How many presets an application keeps (spec, "Presets are bounded"). */
export const PRESET_LIMIT = 20;
export const PRESET_NAME_LIMIT = 60;
export const ENTRY_LIMIT = 50;
export const ENTRY_NAME_LIMIT = 256;
export const ENTRY_VALUE_LIMIT = 4096;

/** The prefix of everything the Frontend Registry keeps in the browser, which a preset can't name. */
const RESERVED_PREFIX = "frontend-registry";
/** A cookie name: an RFC 6265 token. */
const COOKIE_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

export interface PresetEntry {
  readonly store: SessionPresetStore;
  readonly name: string;
  readonly value: string;
}

export interface SessionPreset {
  readonly publicId: string;
  readonly name: string;
  readonly entries: readonly PresetEntry[];
  /** The display name of the workspace that last changed it, when it had one. */
  readonly updatedByName: string | null;
  readonly lockVersion: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface PresetInput {
  readonly name: string;
  readonly entries: readonly { readonly store: string; readonly name: string; readonly value: string }[];
}

type Row = typeof sessionPresets.$inferSelect;

function toPreset(row: Row): SessionPreset {
  return { publicId: row.publicId, name: row.name, entries: row.entries as unknown as PresetEntry[], updatedByName: row.updatedByName, lockVersion: row.lockVersion, createdAt: row.createdAt, updatedAt: row.updatedAt };
}

/** A preset name trimmed, with runs of whitespace made one space. */
function normalized(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

/** A name as presets compare names: normalized and lowercased, so names are unique ignoring case. */
export function presetNameKey(name: string): string {
  return normalized(name).toLowerCase();
}

/** Why +entry+ can't be in a preset, by field, or nothing. */
function entryIssues(entry: PresetInput["entries"][number], index: number, issues: IssueCollector): PresetEntry | null {
  const field = (part: string) => `entries.${index}.${part}`;
  const store = SESSION_PRESET_STORES.find((candidate) => candidate === entry.store);
  if (!store) issues.add(field("store"), "Choose local storage, session storage, a cookie, or a query parameter");
  const name = entry.name.trim();
  if (!name) issues.add(field("name"), "Enter a name");
  else if (name.length > ENTRY_NAME_LIMIT) issues.add(field("name"), `Use at most ${ENTRY_NAME_LIMIT} characters`);
  else if (store !== "query" && name.toLowerCase().startsWith(RESERVED_PREFIX)) issues.add(field("name"), "That name belongs to the Frontend Registry, so a preset can't change it");
  else if (store === "cookie" && !COOKIE_NAME.test(name)) issues.add(field("name"), "A cookie name can have only letters, digits, and the characters ! # $ % & ' * + - . ^ _ ` | ~");
  else if (store === "query" && name === "share") issues.add(field("name"), "The query parameter share belongs to the Frontend Registry's share links, so a preset can't set it");
  if (entry.value.length > ENTRY_VALUE_LIMIT) issues.add(field("value"), `Use at most ${formatNumber(ENTRY_VALUE_LIMIT)} characters`);
  return store && name ? { store, name, value: entry.value } : null;
}

/** +input+ checked by the spec's limits: its name and entries as they're stored, or every problem with them. */
export function checkPreset(input: PresetInput): { name: string; entries: PresetEntry[] } {
  const issues = new IssueCollector();
  const name = normalized(input.name);
  if (!name) issues.add("name", "Enter a name");
  else if (name.length > PRESET_NAME_LIMIT) issues.add("name", `Use at most ${PRESET_NAME_LIMIT} characters`);
  if (input.entries.length === 0) issues.add("entries", "Add at least one entry");
  else if (input.entries.length > ENTRY_LIMIT) issues.add("entries", `A preset can have up to ${ENTRY_LIMIT} entries`);
  const entries = input.entries.slice(0, ENTRY_LIMIT).map((entry, index) => entryIssues(entry, index, issues));
  issues.throwIfAny();
  return { name, entries: entries as PresetEntry[] };
}

const TAKEN = "Another preset of this application has that name. Choose another.";

/** The application's presets, by name, for every workspace. */
export function listPresets(db: Executor, applicationId: number): SessionPreset[] {
  return db.select().from(sessionPresets).where(eq(sessionPresets.applicationId, applicationId)).orderBy(asc(sessionPresets.nameKey), asc(sessionPresets.id)).all().map(toPreset);
}

/** The application's preset +publicId+, as it stands now, or undefined. */
export function findPreset(db: Executor, applicationId: number, publicId: string): SessionPreset | undefined {
  const row = db.select().from(sessionPresets).where(and(eq(sessionPresets.applicationId, applicationId), eq(sessionPresets.publicId, publicId))).get();
  return row ? toPreset(row) : undefined;
}

/** +route+, a route with its query, without the query parameters +preset+ adds: a share link captures the application's own query, never the preset's. */
export function routeWithoutPreset(route: string, preset: Pick<SessionPreset, "entries">): string {
  const names = preset.entries.filter((entry) => entry.store === "query").map((entry) => entry.name);
  const mark = route.indexOf("?");
  if (!names.length || mark === -1) return route;
  const query = new URLSearchParams(route.slice(mark + 1));
  for (const name of names) query.delete(name);
  return `${route.slice(0, mark)}${query.size ? `?${query}` : ""}`;
}

/**
 * Creates a preset of the application +applicationId+, recording
 * +updatedByName+ as the workspace that made it. Throws ValidationError for
 * input past the limits, a name the application already uses, and the 21st
 * preset.
 */
export function createPreset(db: Executor, applicationId: number, input: PresetInput, updatedByName: string | null): SessionPreset {
  const { name, entries } = checkPreset(input);
  return immediate(db, (tx) => {
    const held = tx.select({ total: count() }).from(sessionPresets).where(eq(sessionPresets.applicationId, applicationId)).get()?.total ?? 0;
    if (held >= PRESET_LIMIT) throw new ValidationError([{ field: "base", message: `An application can have ${PRESET_LIMIT} presets. Delete one first.` }]);
    const now = new Date();
    try {
      return toPreset(
        tx
          .insert(sessionPresets)
          .values({ publicId: generatePublicId("ses"), applicationId, name, nameKey: presetNameKey(name), entries: entries as never, updatedByName, createdAt: now, updatedAt: now })
          .returning()
          .get(),
      );
    } catch (error) {
      if (isUniqueViolation(error)) throw new ValidationError([{ field: "name", message: TAKEN }]);
      throw error;
    }
  });
}

/** Raised when an edit was made from an older version of a preset; it carries the preset as it stands now. */
export class StalePresetError extends StaleRecordError {
  constructor(readonly current: SessionPreset) {
    super("Someone else changed this preset since you opened it. Its newer entries are shown; make your change again.");
  }
}

/**
 * Edits the preset +publicId+ from the version +lockVersion+ the editor
 * read, recording +updatedByName+. Throws StalePresetError, with the preset
 * as it stands, when someone else changed it first; NotFoundError when it was
 * deleted; ValidationError as `createPreset` does.
 */
export function editPreset(db: Executor, applicationId: number, publicId: string, lockVersion: number, input: PresetInput, updatedByName: string | null): SessionPreset {
  const { name, entries } = checkPreset(input);
  return immediate(db, (tx) => {
    const row = tx.select().from(sessionPresets).where(and(eq(sessionPresets.applicationId, applicationId), eq(sessionPresets.publicId, publicId))).get();
    if (!row) throw new NotFoundError("That preset no longer exists. Someone else deleted it.");
    if (row.lockVersion !== lockVersion) throw new StalePresetError(toPreset(row));
    try {
      return toPreset(updateLocked(tx, sessionPresets, row, { name, nameKey: presetNameKey(name), entries: entries as never, updatedByName, updatedAt: new Date() }, "Someone else changed this preset since you opened it.", { expected: lockVersion }));
    } catch (error) {
      if (isUniqueViolation(error)) throw new ValidationError([{ field: "name", message: TAKEN }]);
      throw error;
    }
  });
}

/** Deletes the preset +publicId+ for everyone; every workspace's choice of it goes with it. Returns whether it existed. */
export function deletePreset(db: Executor, applicationId: number, publicId: string): boolean {
  return db.delete(sessionPresets).where(and(eq(sessionPresets.applicationId, applicationId), eq(sessionPresets.publicId, publicId))).run().changes > 0;
}

/** The preset the workspace +workspaceId+ starts the application with, or null for the application's own storage. */
export function chosenPreset(db: Executor, workspaceId: number | null, applicationId: number): SessionPreset | null {
  if (workspaceId === null) return null;
  const row = db
    .select({ preset: sessionPresets })
    .from(sessionPresetChoices)
    .innerJoin(sessionPresets, eq(sessionPresets.id, sessionPresetChoices.presetId))
    .where(and(eq(sessionPresetChoices.workspaceId, workspaceId), eq(sessionPresetChoices.applicationId, applicationId)))
    .get();
  return row ? toPreset(row.preset) : null;
}

/**
 * Records that the workspace +workspaceId+ starts the application with the
 * preset +publicId+, or with its own storage for null. Only that workspace's
 * choice changes. Throws NotFoundError for a preset the application doesn't
 * have.
 */
export function choosePreset(db: Executor, workspaceId: number, applicationId: number, publicId: string | null): SessionPreset | null {
  return immediate(db, (tx) => {
    tx.delete(sessionPresetChoices).where(and(eq(sessionPresetChoices.workspaceId, workspaceId), eq(sessionPresetChoices.applicationId, applicationId))).run();
    if (publicId === null) return null;
    const row = tx.select().from(sessionPresets).where(and(eq(sessionPresets.applicationId, applicationId), eq(sessionPresets.publicId, publicId))).get();
    if (!row) throw new NotFoundError("That preset no longer exists. Someone else deleted it.");
    tx.insert(sessionPresetChoices).values({ workspaceId, applicationId, presetId: row.id }).run();
    return toPreset(row);
  });
}
