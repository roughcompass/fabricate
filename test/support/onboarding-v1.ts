import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { type Db, MIGRATIONS_FOLDER, migrateDatabase, openDatabase } from "@/lib/db/client";

/*
 * The onboarding v1 fixture (test/fixtures/onboarding/onboarding-v1.sql):
 * every row the v1 onboarding code wrote for the acceptance fixture, plus a
 * placement whose entitlements the Portal owner changed and open v1 Drafts
 * of each kind. It's loaded right after the storage migration and before its
 * triggers, so frozen rows go in as they were written, then the remaining
 * migrations run over it.
 */

export const V1_FIXTURE = path.resolve("test/fixtures/onboarding/onboarding-v1.sql");
export const V1_STORAGE_MIGRATION = "0024_onboarding_storage";
export const V1_LAST_MIGRATION = "0025_onboarding_triggers";

/** A copy of the committed migrations up to and including +tag+. */
export function migrationFolderAt(tag: string): string {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "fabricate-migrations-"));
  fs.cpSync(MIGRATIONS_FOLDER, folder, { recursive: true });
  const journalFile = path.join(folder, "meta", "_journal.json");
  const journal = JSON.parse(fs.readFileSync(journalFile, "utf8")) as { entries: { idx: number; tag: string }[] };
  const selected = journal.entries.find((entry) => entry.tag === tag);
  if (!selected) throw new Error(`Migration ${tag} does not exist`);
  for (const entry of journal.entries.filter((candidate) => candidate.idx > selected.idx)) fs.rmSync(path.join(folder, `${entry.tag}.sql`), { force: true });
  journal.entries = journal.entries.filter((entry) => entry.idx <= selected.idx);
  fs.writeFileSync(journalFile, JSON.stringify(journal));
  return folder;
}

/**
 * A database holding the v1 fixture under the v1 schema: migrated through
 * the onboarding storage, loaded, then through the v1 triggers. Pass
 * +fixture+ to load a variant of the fixture's SQL.
 */
export function v1Database(fixture = fs.readFileSync(V1_FIXTURE, "utf8")): Db {
  const db = openDatabase(":memory:");
  for (const tag of [V1_STORAGE_MIGRATION, V1_LAST_MIGRATION]) {
    const folder = migrationFolderAt(tag);
    try {
      migrateDatabase(db, folder);
    } finally {
      fs.rmSync(folder, { recursive: true, force: true });
    }
    if (tag === V1_STORAGE_MIGRATION) {
      // The fixture's identities and revisions point at one another, so it's loaded whole and its references checked after.
      db.$client.pragma("foreign_keys = OFF");
      db.$client.exec(fixture);
      db.$client.pragma("foreign_keys = ON");
      const violations = db.$client.pragma("foreign_key_check") as unknown[];
      if (violations.length > 0) throw new Error(`The v1 fixture breaks ${violations.length} foreign keys`);
    }
  }
  return db;
}

/** The v1 fixture under every committed migration. */
export function migratedV1Database(fixture?: string): Db {
  const db = v1Database(fixture);
  migrateDatabase(db, MIGRATIONS_FOLDER);
  return db;
}

const REVISION_TABLES = ["portal_revisions", "application_revisions", "microfrontend_revisions"] as const;

/** The frozen rows of a submitted revision, by table, keyed to the revision column. */
const NORMALIZED_TABLES = {
  portal_environments: "portal_revision_id",
  portal_menu_groups: "portal_revision_id",
  application_environments: "application_revision_id",
  application_launch_targets: "application_revision_id",
  rendering_inference_candidates: "application_revision_id",
  application_components: "application_revision_id",
  placement_requests: "application_revision_id",
} as const;

/** The v1 columns of each table, so a snapshot taken after later migrations compares only what v1 wrote. */
const V1_COLUMNS: Record<string, string[]> = {
  portal_revisions: ["id", "number", "state", "lock_version", "document", "digest", "created_by", "created_at", "updated_at", "submitted_by", "submitted_at", "portal_id", "based_on_revision_id", "owner_team", "seal_id", "runtimes", "contract", "contract_digest"],
  application_revisions: ["id", "number", "state", "lock_version", "document", "digest", "created_by", "created_at", "updated_at", "submitted_by", "submitted_at", "application_id", "based_on_revision_id", "name", "owner_team", "seal_id", "required_capabilities"],
  microfrontend_revisions: ["id", "number", "state", "lock_version", "document", "digest", "created_by", "created_at", "updated_at", "submitted_by", "submitted_at", "microfrontend_id", "based_on_revision_id", "name", "owner_team", "seal_id", "repository_source_id", "workspace_path", "cdaas_app_id", "cdaas_view_id", "contract", "contract_digest"],
  portal_environments: ["id", "portal_revision_id", "environment", "runtime", "enabled", "entitlements", "entitlements_digest", "entitlements_inherited_from"],
  portal_menu_groups: ["id", "portal_revision_id", "key", "parent_key", "label", "ordering"],
  application_environments: ["id", "application_revision_id", "environment"],
  application_launch_targets: ["id", "application_revision_id", "kind", "microfrontend_id", "rendering_mode", "document_url", "module_url", "exported_module", "manifest_url", "exposed_module", "configuration", "host_contract", "host_contract_digest", "confirmation", "confirmed_by", "confirmed_at"],
  rendering_inference_candidates: ["id", "application_revision_id", "rendering_mode", "configuration", "source", "evidence_reference", "observation_id", "observed_at", "chosen"],
  application_components: ["id", "application_revision_id", "microfrontend_id", "role", "mount_kind", "mount_key", "required", "host_configuration"],
  placement_requests: ["id", "placement_id", "application_revision_id", "menu_parent_key", "route", "label", "ordering", "entitlements", "entitlements_digest", "default_requested", "created_at"],
  placement_request_environments: ["id", "placement_request_id", "environment"],
  application_placements: ["id", "public_id", "application_id", "portal_id", "created_at"],
  placement_decisions: ["id", "public_id", "placement_id", "placement_request_id", "portal_revision_id", "application_revision_id", "sequence", "decision", "reason", "accepted_route", "accepted_menu_parent_key", "accepted_label", "accepted_ordering", "accepted_entitlements", "accepted_defaults", "actor", "attribution", "decided_at"],
  placement_routes: ["id", "placement_id", "decision_id", "portal_id", "application_id", "environment", "route", "active", "activated_at", "deactivated_at"],
  portal_default_routes: ["id", "portal_id", "environment", "sequence", "placement_id", "decision_id", "actor", "attribution", "assigned_at"],
  onboarding_validations: ["id", "subject", "portal_revision_id", "application_revision_id", "microfrontend_revision_id", "document_digest", "blocking", "issues", "evaluated_at"],
  onboarding_events: ["id", "subject", "portal_id", "application_id", "microfrontend_id", "revision", "event", "from_lifecycle", "to_lifecycle", "reason", "actor", "attribution", "occurred_at"],
  portals: ["id", "public_id", "label", "label_key", "seal_id", "owner_team", "lifecycle", "active_revision_id", "draft_revision_id", "lock_version", "created_at"],
  applications: ["id", "public_id", "seal_id", "name", "owner_team", "lifecycle", "active_revision_id", "draft_revision_id", "lock_version", "created_at"],
  microfrontends: ["id", "public_id", "name", "seal_id", "owner_team", "lifecycle", "active_revision_id", "draft_revision_id", "cdaas_app_id", "cdaas_view_id", "lock_version", "created_at"],
};

const rows = (db: Db, table: string) => db.$client.prepare(`select ${V1_COLUMNS[table]!.map((column) => `"${column}"`).join(", ")} from "${table}" order by id`).all() as Record<string, unknown>[];

/** Everything the v1 fixture recorded, as v1 wrote it: every row of every onboarding table, in its v1 columns. */
export function v1Snapshot(db: Db) {
  return Object.fromEntries(Object.keys(V1_COLUMNS).map((table) => [table, rows(db, table)]));
}

/** Each revision's ID, number, state, and digest, by table. */
export function revisionDigests(db: Db) {
  return Object.fromEntries(REVISION_TABLES.map((table) => [table, db.$client.prepare(`select id, number, state, digest from "${table}" order by id`).all()]));
}

/** For each submitted revision, how many frozen rows each table holds for it. */
export function normalizedCounts(db: Db) {
  return Object.fromEntries(
    Object.entries(NORMALIZED_TABLES).map(([table, column]) => [table, db.$client.prepare(`select ${column} as revision, count(*) as rows from "${table}" group by ${column} order by ${column}`).all()]),
  );
}

/**
 * Checks the fixture holds what the format-version migration must carry:
 * submitted and Draft revisions of each kind, runtimes, Portal and MFE
 * contracts, Portal entitlements (stated and inherited), required
 * capabilities, an external host contract, child host configuration, and
 * placement entitlements a Portal owner changed. Throws naming what's absent.
 */
export function verifyV1Fixture(db: Db): void {
  const missing: string[] = [];
  const has = (label: string, statement: string) => {
    if (!(db.$client.prepare(statement).get() as { found: number }).found) missing.push(label);
  };
  for (const table of REVISION_TABLES) {
    has(`${table}: a submitted revision`, `select exists (select 1 from ${table} where state = 'submitted') as found`);
    has(`${table}: a Draft`, `select exists (select 1 from ${table} where state = 'draft') as found`);
  }
  has("Portal runtimes", "select exists (select 1 from portal_revisions where state = 'submitted' and json_array_length(runtimes) > 0) as found");
  has("a Portal contract", "select exists (select 1 from portal_revisions where contract is not null and contract_digest is not null) as found");
  has("Portal entitlements", "select exists (select 1 from portal_environments where json_array_length(entitlements, '$.codes') > 0) as found");
  has("an inherited Portal entitlement in a Draft", "select exists (select 1 from portal_revisions, json_each(document, '$.environments') where state = 'draft' and json_extract(value, '$.inheritFrom') is not null) as found");
  has("required capabilities", "select exists (select 1 from application_revisions where json_array_length(required_capabilities) > 0) as found");
  has("an MFE contract", "select exists (select 1 from microfrontend_revisions where contract is not null and json_array_length(contract, '$.exports') > 0) as found");
  has("an MFE Draft with more than one iframe export", "select exists (select 1 from microfrontend_revisions where state = 'draft' and (select count(*) from json_each(document, '$.contract.exports') where json_extract(value, '$.modes') like '%iframe%') > 1) as found");
  has("an external host contract", "select exists (select 1 from application_launch_targets where host_contract is not null) as found");
  has("child host configuration", "select exists (select 1 from application_components where host_configuration <> '{}') as found");
  has("placement entitlements", "select exists (select 1 from placement_requests where json_array_length(entitlements, '$.codes') > 0) as found");
  has("entitlements a Portal owner changed", "select exists (select 1 from placement_decisions d join placement_requests r on r.id = d.placement_request_id where d.accepted_entitlements <> r.entitlements) as found");
  has("an approved and a rejected placement", "select (select count(distinct decision) from placement_decisions where decision in ('approve', 'reject')) = 2 as found");
  if (missing.length > 0) throw new Error(`Incomplete onboarding v1 fixture: ${missing.join("; ")}`);
}

/**
 * Writes the v1 fixture into an empty database that has every migration,
 * such as the browser tests' server database, as the format-version
 * migration would have left it: each revision version 1. The triggers that
 * refuse a new v1 revision, or rows written after submission, are lifted
 * for the load and restored, and every foreign key is checked after.
 */
export function loadV1Fixture(db: Db, fixture = fs.readFileSync(V1_FIXTURE, "utf8")): void {
  const triggers = db.$client.prepare("select name, sql from sqlite_master where type = 'trigger' and sql is not null").all() as { name: string; sql: string }[];
  db.$client.pragma("foreign_keys = OFF");
  try {
    db.$client.transaction(() => {
      for (const trigger of triggers) db.$client.exec(`DROP TRIGGER "${trigger.name}"`);
      // Each revision row is written as version 1, which its checks need from the start.
      const versioned = fixture.replace(new RegExp(`^(INSERT INTO "(?:${REVISION_TABLES.join("|")})" \\(.*)\\) VALUES \\((.*)\\);$`, "gm"), '$1, "format_version") VALUES ($2, 1);');
      db.$client.exec(versioned);
      for (const trigger of triggers) db.$client.exec(trigger.sql);
    })();
  } finally {
    db.$client.pragma("foreign_keys = ON");
  }
  const violations = db.$client.pragma("foreign_key_check") as unknown[];
  if (violations.length > 0) throw new Error(`The v1 fixture breaks ${violations.length} foreign keys`);
}
