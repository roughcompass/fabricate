import { and, asc, count, desc, eq, gt, max, ne, sql } from "drizzle-orm";
import { type FrontendRegistryConfig, getConfig } from "@/lib/config";
import { type Executor, immediate } from "@/lib/db/client";
import { NotFoundError, StaleRecordError, ValidationError, isUniqueViolation } from "@/lib/db/errors";
import { generatePublicId } from "@/lib/db/ids";
import { type MockSetSource, mockRules, mockSets } from "@/lib/db/schema";
import { type CallInput, type CheckedRule, checkRule, checkSet, ruleFromCall, setNameKey } from "./checks";
import { applicationDefaultSetId } from "./defaults";
import { MB, type MockRule, type MockSet, RULE_LIMIT, type RuleInput, SET_BODY_LIMIT, SET_LIMIT, type SetInput, type StoredResponse, toMockRule, toMockSet } from "./model";
import { discardDirectory, hasBody, removeUnusedBodies, setDirectory, writeBody } from "./storage";

/*
/*
 * Mock sets and their rules (add-mock-sets, design decisions 9 and 10;
 * applications/mock-sets spec). Sets belong to the application, so anyone
 * who can open it creates, edits, and deletes them, as with session presets;
 * each set and rule records who last changed it, by the workspace's display
 * name, and edits carry lock versions. Every change to a set or its rules
 * moves its revision on, and keeps its rule count and body size in the same
 * transaction. Bodies are stored as files, by digest, inside the transaction
 * that writes the rows naming them, so no other writer can see a row whose
 * body isn't there yet, or prune a body a row is about to name.
 */


// -- Reading -----------------------------------------------------------------------

export interface MockSetSummary extends MockSet {
  /** Whether it's the application's default set. */
  readonly isDefault: boolean;
}

/**
 * The application's sets, by name, each marked when it's the default: at most 10 rows, with their denormalized counts.
 * @public The mock sets' pages and endpoints use this (add-mock-sets, tasks 4.2 and 5).
 */
export function listSets(db: Executor, applicationId: number): MockSetSummary[] {
  const defaultId = applicationDefaultSetId(db, applicationId);
  return db
    .select()
    .from(mockSets)
    .where(eq(mockSets.applicationId, applicationId))
    .orderBy(asc(mockSets.nameKey), asc(mockSets.id))
    .all()
    .map((row) => ({ ...toMockSet(row), isDefault: row.id === defaultId }));
}

/** The application's set +publicId+, as it stands now, or undefined. */
export function findSet(db: Executor, applicationId: number, publicId: string): MockSet | undefined {
  const row = db
    .select()
    .from(mockSets)
    .where(and(eq(mockSets.applicationId, applicationId), eq(mockSets.publicId, publicId)))
    .get();
  return row ? toMockSet(row) : undefined;
}

/** The application's set +publicId+, or a NotFoundError: a set of another application isn't found. */
export function getSet(db: Executor, applicationId: number, publicId: string): MockSet {
  const set = findSet(db, applicationId, publicId);
  if (!set) throw new NotFoundError("That mock set no longer exists. Someone else deleted it.");
  return set;
}


/**
 * The set's rule +publicId+, or undefined.
 * @public The mock sets' pages and endpoints use this (add-mock-sets, tasks 4.2 and 5).
 */
export function findRule(db: Executor, set: Pick<MockSet, "id">, publicId: string): MockRule | undefined {
  const row = db
    .select()
    .from(mockRules)
    .where(and(eq(mockRules.setId, set.id), eq(mockRules.publicId, publicId)))
    .get();
  return row ? toMockRule(row) : undefined;
}

function getRule(db: Executor, set: Pick<MockSet, "id">, publicId: string): typeof mockRules.$inferSelect {
  const row = db
    .select()
    .from(mockRules)
    .where(and(eq(mockRules.setId, set.id), eq(mockRules.publicId, publicId)))
    .get();
  if (!row) throw new NotFoundError("That rule no longer exists. Someone else deleted it.");
  return row;
}

/** Every rule of the set, in the set's order: at most 500 rows, for compiling and exporting. */
export function allRules(db: Executor, setId: number): MockRule[] {
  return db.select().from(mockRules).where(eq(mockRules.setId, setId)).orderBy(asc(mockRules.position), asc(mockRules.id)).all().map(toMockRule);
}

/** What the set's page filters its rules by. */
export interface RuleFilter {
  /** Text the pattern contains. */
  readonly path?: string;
  /** A method, or `*` for rules matching any. */
  readonly method?: string;
  readonly state?: "on" | "off" | "needs-response";
}

export const RULES_PAGE_SIZE = 50;

/**
 * One page of the set's rules that match +filter+, in the set's order, with how many match in all and how many need a response.
 * @public The mock sets' pages and endpoints use this (add-mock-sets, tasks 4.2 and 5).
 */
export function pageOfRules(db: Executor, setId: number, filter: RuleFilter, page: number): { rules: MockRule[]; total: number; needingResponse: number } {
  const conditions = [eq(mockRules.setId, setId)];
  if (filter.path) conditions.push(sql`instr(lower(${mockRules.pattern}), ${filter.path.toLowerCase()}) > 0`);
  if (filter.method) conditions.push(eq(mockRules.method, filter.method));
  if (filter.state === "on") conditions.push(eq(mockRules.enabled, true));
  if (filter.state === "off") conditions.push(eq(mockRules.enabled, false));
  if (filter.state === "needs-response") conditions.push(sql`json_array_length(${mockRules.responses}) = 0`);
  const where = and(...conditions);
  const total = db.select({ total: count() }).from(mockRules).where(where).get()?.total ?? 0;
  const needingResponse = db.select({ total: count() }).from(mockRules).where(and(eq(mockRules.setId, setId), sql`json_array_length(${mockRules.responses}) = 0`)).get()?.total ?? 0;
  const rules = db
    .select()
    .from(mockRules)
    .where(where)
    .orderBy(asc(mockRules.position), asc(mockRules.id))
    .limit(RULES_PAGE_SIZE)
    .offset(Math.max(0, page - 1) * RULES_PAGE_SIZE)
    .all()
    .map(toMockRule);
  return { rules, total, needingResponse };
}

/** The bodies of every set's rules together, against `previews.maxMockStorageBytes`. */
export function storedBodyBytes(db: Executor): number {
  return Number(db.select({ total: sql<number>`coalesce(sum(${mockSets.bodyBytes}), 0)` }).from(mockSets).get()?.total ?? 0);
}

// -- Limits ------------------------------------------------------------------------

const TOO_MANY_SETS = `An application can have ${SET_LIMIT} mock sets. Delete one first.`;
const TOO_MANY_RULES = `A mock set can have ${RULE_LIMIT} rules. Delete rules it no longer needs first.`;
const SET_TOO_LARGE = `A mock set's responses can hold ${SET_BODY_LIMIT / MB} MB in all. Remove large responses, or put them in another mock set.`;
const STORAGE_FULL = "Mock set storage is full. Deleting mock sets that are no longer used frees it.";

/** Every body a set's rules name, by digest with its size, with +replacing+'s rule left out and +adding+ in. */
function setBodies(tx: Executor, setId: number, replacing: number | null, adding: readonly (Pick<MockRule, "body" | "responses">)[]): Map<string, number> {
  const bodies = new Map<string, number>();
  const add = (rule: Pick<MockRule, "body" | "responses">) => {
    if (rule.body) bodies.set(rule.body.digest, rule.body.size);
    for (const response of rule.responses) if (response.body) bodies.set(response.body.digest, response.body.size);
  };
  const rows = tx
    .select({ id: mockRules.id, bodyDigest: mockRules.bodyDigest, bodySize: mockRules.bodySize, responses: mockRules.responses })
    .from(mockRules)
    .where(replacing === null ? eq(mockRules.setId, setId) : and(eq(mockRules.setId, setId), ne(mockRules.id, replacing)))
    .all();
  for (const row of rows) add({ body: row.bodyDigest ? { digest: row.bodyDigest, size: row.bodySize ?? 0, type: null } : null, responses: row.responses as unknown as StoredResponse[] });
  for (const rule of adding) add(rule);
  return bodies;
}

const total = (bodies: Map<string, number>) => [...bodies.values()].reduce((sum, size) => sum + size, 0);

/** Throws a ValidationError when +bytes+ would take the set past 20 MB, or every set past `previews.maxMockStorageBytes`. */
function checkStorage(tx: Executor, set: Pick<MockSet, "id" | "bodyBytes">, bytes: number, config: FrontendRegistryConfig, field = "base"): void {
  if (bytes > SET_BODY_LIMIT) throw new ValidationError([{ field, message: SET_TOO_LARGE }]);
  if (bytes > set.bodyBytes && storedBodyBytes(tx) - set.bodyBytes + bytes > config.previews.maxMockStorageBytes) throw new ValidationError([{ field, message: STORAGE_FULL }]);
}

/** The ValidationError a change past the rule limit gets. */
export function tooManyRules(): ValidationError {
  return new ValidationError([{ field: "base", message: TOO_MANY_RULES }]);
}

// -- Sets --------------------------------------------------------------------------

const TAKEN = "Another mock set of this application has that name. Choose another.";

function nameTaken(error: unknown): never {
  if (isUniqueViolation(error)) throw new ValidationError([{ field: "name", message: TAKEN }]);
  throw error;
}

/**
 * Creates an empty set of the application +applicationId+, recording
 * +byName+ as who made it. Throws ValidationError past the limits, for a
 * name the application already uses, and for the 11th set.
 * @public The mock sets' pages and endpoints use this (add-mock-sets, tasks 4.2 and 5).
 */
export function createSet(db: Executor, applicationId: number, input: SetInput & { source?: MockSetSource; sourceFile?: string | null }, byName: string | null): MockSet {
  const checked = checkSet(input);
  return immediate(db, (tx) => insertSet(tx, applicationId, { ...checked, source: input.source ?? "written", sourceFile: input.sourceFile ?? null }, byName));
}

/** Inserts a set inside a transaction the caller holds, checking the application's limit. */
export function insertSet(tx: Executor, applicationId: number, values: ReturnType<typeof checkSet> & { source: MockSetSource; sourceFile: string | null }, byName: string | null): MockSet {
  const held = tx.select({ total: count() }).from(mockSets).where(eq(mockSets.applicationId, applicationId)).get()?.total ?? 0;
  if (held >= SET_LIMIT) throw new ValidationError([{ field: "base", message: TOO_MANY_SETS }]);
  const now = new Date();
  try {
    return toMockSet(
      tx
        .insert(mockSets)
        .values({
          publicId: generatePublicId("mks"),
          applicationId,
          name: values.name,
          nameKey: setNameKey(values.name),
          description: values.description,
          source: values.source,
          sourceFile: values.sourceFile ? values.sourceFile.slice(0, 255) : null,
          hostMode: values.hostMode,
          hosts: values.hosts as never,
          unmatched: values.unmatched,
          createdByName: byName,
          updatedByName: byName,
          createdAt: now,
          updatedAt: now,
        })
        .returning()
        .get(),
    );
  } catch (error) {
    return nameTaken(error);
  }
}

/** Raised when an edit was made from an older version of a set's settings; it carries the set as it stands now. */
export class StaleMockSetError extends StaleRecordError {
  constructor(readonly current: MockSet) {
    super("Someone else changed this mock set since you opened it. Its newer settings are shown; make your change again.");
  }
}

/** Raised when an edit was made from an older version of a rule; it carries the rule as it stands now. */
export class StaleMockRuleError extends StaleRecordError {
  constructor(readonly current: MockRule) {
    super("Someone else changed this rule since you opened it. Its newer values are shown; make your change again.");
  }
}

/** Moves the set's revision on, with its rule count, body size, and who changed it, inside the caller's transaction. */
function touchSet(tx: Executor, setId: number, byName: string | null, values: { ruleCount?: number; bodyBytes?: number } = {}): MockSet {
  return toMockSet(
    tx
      .update(mockSets)
      .set({ revision: sql`${mockSets.revision} + 1`, updatedByName: byName, updatedAt: new Date(), ...values })
      .where(eq(mockSets.id, setId))
      .returning()
      .get()!,
  );
}

/**
 * Edits the settings of the set +publicId+ from the version +lockVersion+
 * the editor read: its name, description, hosts, and calls no rule matches.
 * Throws StaleMockSetError, with the set as it stands, when someone else
 * changed them first.
 * @public The mock sets' pages and endpoints use this (add-mock-sets, tasks 4.2 and 5).
 */
export function editSet(db: Executor, applicationId: number, publicId: string, lockVersion: number, input: SetInput, byName: string | null): MockSet {
  const checked = checkSet(input);
  return immediate(db, (tx) => {
    const set = getSet(tx, applicationId, publicId);
    if (set.lockVersion !== lockVersion) throw new StaleMockSetError(set);
    try {
      return toMockSet(
        tx
          .update(mockSets)
          .set({
            name: checked.name,
            nameKey: setNameKey(checked.name),
            description: checked.description,
            hostMode: checked.hostMode,
            hosts: checked.hosts as never,
            unmatched: checked.unmatched,
            revision: set.revision + 1,
            lockVersion: set.lockVersion + 1,
            updatedByName: byName,
            updatedAt: new Date(),
          })
          .where(and(eq(mockSets.id, set.id), eq(mockSets.lockVersion, lockVersion)))
          .returning()
          .get()!,
      );
    } catch (error) {
      return nameTaken(error);
    }
  });
}

/**
 * Deletes the set +publicId+ for everyone, with its rules and their stored
 * bodies, and, by cascade, every default and choice that names it. Returns
 * the set as it was, or undefined when it no longer existed.
 * @public The mock sets' pages and endpoints use this (add-mock-sets, tasks 4.2 and 5).
 */
export function deleteSet(db: Executor, applicationId: number, publicId: string, config: FrontendRegistryConfig = getConfig()): MockSet | undefined {
  const deleted = db
    .delete(mockSets)
    .where(and(eq(mockSets.applicationId, applicationId), eq(mockSets.publicId, publicId)))
    .returning()
    .get();
  if (!deleted) return undefined;
  discardDirectory(config, setDirectory(config, deleted.publicId));
  return toMockSet(deleted);
}

// -- Rules -------------------------------------------------------------------------

/** Writes +bodies+ into the set's directory, inside the caller's transaction. */
function storeBodies(config: FrontendRegistryConfig, set: Pick<MockSet, "publicId">, bodies: Map<string, Uint8Array>): void {
  const directory = setDirectory(config, set.publicId);
  for (const bytes of bodies.values()) writeBody(directory, bytes);
}

/** Refuses a kept body the set doesn't hold, which only a crafted form could name. */
function checkKept(config: FrontendRegistryConfig, set: Pick<MockSet, "publicId">, kept: Set<string>): void {
  const directory = setDirectory(config, set.publicId);
  for (const digest of kept) if (!hasBody(directory, digest)) throw new ValidationError([{ field: "base", message: "A response's stored body is no longer there. Write the body again." }]);
}

/** Removes the set's stored bodies that no rule names any more, inside the caller's transaction. */
function pruneBodies(config: FrontendRegistryConfig, set: Pick<MockSet, "publicId">, bodies: Map<string, number>): void {
  removeUnusedBodies(setDirectory(config, set.publicId), new Set(bodies.keys()));
}

function ruleCount(tx: Executor, setId: number): number {
  return tx.select({ total: count() }).from(mockRules).where(eq(mockRules.setId, setId)).get()?.total ?? 0;
}

function nextPosition(tx: Executor, setId: number): number {
  const last = tx.select({ last: max(mockRules.position) }).from(mockRules).where(eq(mockRules.setId, setId)).get()?.last;
  return last === null || last === undefined ? 0 : last + 1;
}

interface RuleChange {
  readonly rule: MockRule;
  readonly set: MockSet;
}

/**
 * Adds rules to the end of the set, in the order given, inside the caller's
 * transaction: what creating a rule, starting a set from calls, and saving an
 * import share. Checks the rule and storage limits, writes the bodies, and
 * moves the set's revision on once.
 */
export function appendRules(tx: Executor, set: MockSet, rules: readonly CheckedRule[], byName: string | null, config: FrontendRegistryConfig): { rules: MockRule[]; set: MockSet } {
  const held = ruleCount(tx, set.id);
  if (held + rules.length > RULE_LIMIT) throw tooManyRules();
  const added = rules.map((rule) => ({ body: rule.row.bodyDigest ? { digest: rule.row.bodyDigest, size: rule.row.bodySize ?? 0, type: null } : null, responses: rule.row.responses as unknown as StoredResponse[] }));
  const bodies = setBodies(tx, set.id, null, added);
  checkStorage(tx, set, total(bodies), config);
  for (const rule of rules) checkKept(config, set, rule.kept);
  for (const rule of rules) storeBodies(config, set, rule.bodies);
  let position = nextPosition(tx, set.id);
  const now = new Date();
  const inserted = rules.map((rule) =>
    toMockRule(
      tx
        .insert(mockRules)
        .values({ ...rule.row, publicId: generatePublicId("mkr"), setId: set.id, position: position++, createdByName: byName, updatedByName: byName, createdAt: now, updatedAt: now })
        .returning()
        .get(),
    ),
  );
  return { rules: inserted, set: touchSet(tx, set.id, byName, { ruleCount: held + rules.length, bodyBytes: total(bodies) }) };
}

/**
 * Creates a rule at the end of the set +setPublicId+, recording +byName+.
 * A rule without a response is added turned off, marked Needs a response.
 * @public The mock sets' pages and endpoints use this (add-mock-sets, tasks 4.2 and 5).
 */
export function createRule(db: Executor, applicationId: number, setPublicId: string, input: RuleInput, byName: string | null, config: FrontendRegistryConfig = getConfig()): RuleChange {
  const checked = checkRule(input);
  return immediate(db, (tx) => {
    const set = getSet(tx, applicationId, setPublicId);
    const { rules, set: touched } = appendRules(tx, set, [checked], byName, config);
    return { rule: rules[0]!, set: touched };
  });
}

/**
 * Edits the rule +rulePublicId+ from the version +lockVersion+ the editor
 * read, recording +byName+. Throws StaleMockRuleError, with the rule as it
 * stands, when someone else changed it first. Its order of responses starts
 * over, since the set's revision moves on.
 * @public The mock sets' pages and endpoints use this (add-mock-sets, tasks 4.2 and 5).
 */
export function editRule(db: Executor, applicationId: number, setPublicId: string, rulePublicId: string, lockVersion: number, input: RuleInput, byName: string | null, config: FrontendRegistryConfig = getConfig()): RuleChange {
  const checked = checkRule(input);
  return immediate(db, (tx) => {
    const set = getSet(tx, applicationId, setPublicId);
    const row = getRule(tx, set, rulePublicId);
    if (row.lockVersion !== lockVersion) throw new StaleMockRuleError(toMockRule(row));
    const changed = { body: checked.row.bodyDigest ? { digest: checked.row.bodyDigest, size: checked.row.bodySize ?? 0, type: null } : null, responses: checked.row.responses as unknown as StoredResponse[] };
    const bodies = setBodies(tx, set.id, row.id, [changed]);
    checkStorage(tx, set, total(bodies), config);
    checkKept(config, set, checked.kept);
    storeBodies(config, set, checked.bodies);
    const rule = toMockRule(
      tx
        .update(mockRules)
        .set({ ...checked.row, lockVersion: row.lockVersion + 1, updatedByName: byName, updatedAt: new Date() })
        .where(and(eq(mockRules.id, row.id), eq(mockRules.lockVersion, lockVersion)))
        .returning()
        .get()!,
    );
    pruneBodies(config, set, bodies);
    return { rule, set: touchSet(tx, set.id, byName, { bodyBytes: total(bodies) }) };
  });
}

/**
 * Turns the rule on or off. A rule without a response can't be turned on.
 * @public The mock sets' pages and endpoints use this (add-mock-sets, tasks 4.2 and 5).
 */
export function setRuleEnabled(db: Executor, applicationId: number, setPublicId: string, rulePublicId: string, enabled: boolean, byName: string | null): RuleChange {
  return immediate(db, (tx) => {
    const set = getSet(tx, applicationId, setPublicId);
    const row = getRule(tx, set, rulePublicId);
    if (enabled && (row.responses as unknown[]).length === 0) throw new ValidationError([{ field: "base", message: "Write a response for this rule before turning it on." }]);
    const rule = toMockRule(
      tx
        .update(mockRules)
        .set({ enabled, lockVersion: row.lockVersion + 1, updatedByName: byName, updatedAt: new Date() })
        .where(eq(mockRules.id, row.id))
        .returning()
        .get()!,
    );
    return { rule, set: touchSet(tx, set.id, byName) };
  });
}

/**
 * Moves the rule one place up or down the set's order, swapping it with its neighbor; at either end nothing changes.
 * @public The mock sets' pages and endpoints use this (add-mock-sets, tasks 4.2 and 5).
 */
export function moveRule(db: Executor, applicationId: number, setPublicId: string, rulePublicId: string, direction: "up" | "down", byName: string | null): RuleChange {
  return immediate(db, (tx) => {
    const set = getSet(tx, applicationId, setPublicId);
    const row = getRule(tx, set, rulePublicId);
    const neighbor = tx
      .select()
      .from(mockRules)
      .where(and(eq(mockRules.setId, set.id), direction === "up" ? sql`(${mockRules.position}, ${mockRules.id}) < (${row.position}, ${row.id})` : sql`(${mockRules.position}, ${mockRules.id}) > (${row.position}, ${row.id})`))
      .orderBy(direction === "up" ? desc(mockRules.position) : asc(mockRules.position), direction === "up" ? desc(mockRules.id) : asc(mockRules.id))
      .limit(1)
      .get();
    if (!neighbor) return { rule: toMockRule(row), set };
    // Equal positions, which deleting never makes but a crafted order could, are first told apart.
    const [mine, theirs] = neighbor.position === row.position ? (direction === "up" ? [row.position, row.position + 1] : [row.position + 1, row.position]) : [neighbor.position, row.position];
    if (neighbor.position === row.position) tx.update(mockRules).set({ position: sql`${mockRules.position} + 1` }).where(and(eq(mockRules.setId, set.id), gt(mockRules.position, row.position))).run();
    tx.update(mockRules).set({ position: theirs }).where(eq(mockRules.id, neighbor.id)).run();
    const rule = toMockRule(tx.update(mockRules).set({ position: mine, updatedByName: byName, updatedAt: new Date() }).where(eq(mockRules.id, row.id)).returning().get()!);
    return { rule, set: touchSet(tx, set.id, byName) };
  });
}

/**
 * Adds a copy of the rule right after it, turned off, so the copy never answers before it's changed.
 * @public The mock sets' pages and endpoints use this (add-mock-sets, tasks 4.2 and 5).
 */
export function duplicateRule(db: Executor, applicationId: number, setPublicId: string, rulePublicId: string, byName: string | null): RuleChange {
  return immediate(db, (tx) => {
    const set = getSet(tx, applicationId, setPublicId);
    const row = getRule(tx, set, rulePublicId);
    const held = ruleCount(tx, set.id);
    if (held >= RULE_LIMIT) throw tooManyRules();
    tx.update(mockRules).set({ position: sql`${mockRules.position} + 1` }).where(and(eq(mockRules.setId, set.id), gt(mockRules.position, row.position))).run();
    const now = new Date();
    const { id: _id, publicId: _publicId, lockVersion: _lockVersion, ...copy } = row;
    const rule = toMockRule(
      tx
        .insert(mockRules)
        .values({ ...copy, publicId: generatePublicId("mkr"), position: row.position + 1, enabled: false, createdByName: byName, updatedByName: byName, createdAt: now, updatedAt: now })
        .returning()
        .get(),
    );
    return { rule, set: touchSet(tx, set.id, byName, { ruleCount: held + 1 }) };
  });
}

/**
 * Deletes the rule for everyone, and the bodies no other rule of the set names. Throws NotFoundError when it no longer existed.
 * @public The mock sets' pages and endpoints use this (add-mock-sets, tasks 4.2 and 5).
 */
export function deleteRule(db: Executor, applicationId: number, setPublicId: string, rulePublicId: string, byName: string | null, config: FrontendRegistryConfig = getConfig()): MockSet {
  return immediate(db, (tx) => {
    const set = getSet(tx, applicationId, setPublicId);
    const row = getRule(tx, set, rulePublicId);
    tx.delete(mockRules).where(eq(mockRules.id, row.id)).run();
    const bodies = setBodies(tx, set.id, null, []);
    pruneBodies(config, set, bodies);
    return touchSet(tx, set.id, byName, { ruleCount: ruleCount(tx, set.id), bodyBytes: total(bodies) });
  });
}

/**
 * Adds a rule for each of +calls+ to the set, each needing a response.
 * @public The mock sets' pages and endpoints use this (add-mock-sets, tasks 4.2 and 5).
 */
export function addRulesFromCalls(db: Executor, applicationId: number, setPublicId: string, calls: readonly CallInput[], byName: string | null, config: FrontendRegistryConfig = getConfig()): { rules: MockRule[]; set: MockSet } {
  const checked = calls.map((call) => checkRule(ruleFromCall(call)));
  return immediate(db, (tx) => appendRules(tx, getSet(tx, applicationId, setPublicId), checked, byName, config));
}
