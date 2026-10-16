import fs from "node:fs";
import type { Db } from "@/lib/db/client";
import { migrateDatabase } from "@/lib/db/client";
import { migrationFolderAt, v1Database } from "./onboarding-v1";

/*
 * The onboarding v2 fixture: the v1 fixture carried through the format
 * migration to the last schema with revisions, environments, and placements
 * (0031), plus v2 rows written directly the way the v2 onboarding code wrote
 * them. The code itself is gone (make-applications-first-class), so the rows
 * are plain inserts with the frozen-row triggers lifted, as loadV1Fixture
 * does.
 *
 * Over the v1 fixture's Access (Active), Markets (Ready), and Treasury
 * (Draft), it adds:
 * - Lending, a Retired Portal
 * - Ledger in Markets, approved at /ledger in PROD and /ledger-uat in UAT,
 *   and PROD's default there; Activity in Markets, UAT's default
 * - Statements in Markets, approved only in UAT at /ledger, which collides
 *   with Ledger's PROD route once menus are flattened
 * - Cards, placed first in Treasury and never decided, then approved in
 *   Markets
 * - an imported demo deployment with a comment thread and a share link, and
 *   a template deployment that stays
 */

export const LAST_REVISIONED_MIGRATION = "0031_portal_identity";
const DIGEST = "0".repeat(64);
const AT = 1_791_200_000_000;

function insert(db: Db, table: string, row: Record<string, unknown>): number {
  const columns = Object.keys(row);
  const statement = `insert into "${table}" (${columns.map((column) => `"${column}"`).join(", ")}) values (${columns.map(() => "?").join(", ")}) returning id`;
  return (db.$client.prepare(statement).get(...Object.values(row)) as { id: number }).id;
}

interface Placement {
  application: number;
  portal: number;
  portalRevision: number;
  applicationRevision: number;
  label: string;
  /** Routes by environment; none leaves the placement undecided. */
  routes?: Record<string, string>;
  createdAt: number;
}

function place(db: Db, placement: Placement, index: number): { placement: number; decision: number | null } {
  const placementId = insert(db, "application_placements", { public_id: `plc_v2fixture${String(index).padStart(5, "0")}`, application_id: placement.application, portal_id: placement.portal, created_at: placement.createdAt });
  const [route = "/pending"] = Object.values(placement.routes ?? {});
  const request = insert(db, "placement_requests", {
    placement_id: placementId,
    application_revision_id: placement.applicationRevision,
    route,
    label: placement.label,
    ordering: index,
    entitlements: "{}",
    entitlements_digest: DIGEST,
    default_requested: 0,
    created_at: placement.createdAt,
  });
  if (!placement.routes) return { placement: placementId, decision: null };
  const decision = insert(db, "placement_decisions", {
    public_id: `pdc_v2fixture${String(index).padStart(5, "0")}`,
    placement_id: placementId,
    placement_request_id: request,
    portal_revision_id: placement.portalRevision,
    application_revision_id: placement.applicationRevision,
    sequence: 0,
    decision: "approve",
    accepted_route: route,
    accepted_label: placement.label,
    accepted_ordering: index,
    accepted_entitlements: "{}",
    accepted_defaults: "[]",
    actor: "cy@example.com",
    attribution: "unverified",
    decided_at: placement.createdAt,
  });
  for (const [environment, path] of Object.entries(placement.routes)) {
    insert(db, "placement_routes", { placement_id: placementId, decision_id: decision, portal_id: placement.portal, application_id: placement.application, environment, route: path, active: 1, activated_at: placement.createdAt });
  }
  return { placement: placementId, decision };
}

function application(db: Db, name: string, publicId: string): { application: number; revision: number } {
  const id = insert(db, "applications", { public_id: publicId, seal_id: "88004", name, created_at: AT, owner_team: "Markets Platform", lifecycle: "ready" });
  const revision = insert(db, "application_revisions", { number: 1, state: "draft", document: "{}", created_by: "Ana", created_at: AT, updated_at: AT, application_id: id, format_version: 2 });
  return { application: id, revision };
}

/** The v2 rows, written into a database at LAST_REVISIONED_MIGRATION. */
export function seedV2(db: Db): void {
  const triggers = db.$client.prepare("select name, sql from sqlite_master where type = 'trigger' and sql is not null").all() as { name: string; sql: string }[];
  db.$client.pragma("foreign_keys = OFF");
  try {
    db.$client.transaction(() => {
      for (const trigger of triggers) db.$client.exec(`DROP TRIGGER "${trigger.name}"`);

      const lending = insert(db, "portals", { public_id: "ptl_v2lending0000000", label: "Lending", label_key: "lending", created_at: AT, seal_id: "88005", owner_team: "Lending Platform", lifecycle: "retired" });
      insert(db, "portal_revisions", { number: 1, state: "draft", document: "{}", created_by: "Ana", created_at: AT, updated_at: AT, portal_id: lending, format_version: 2 });

      const markets = (db.$client.prepare("select id from portals where label = 'Markets'").get() as { id: number }).id;
      const treasury = (db.$client.prepare("select id from portals where label = 'Treasury'").get() as { id: number }).id;
      const marketsRevision = (db.$client.prepare("select id from portal_revisions where portal_id = ? and state = 'submitted' order by number desc").get(markets) as { id: number }).id;
      const treasuryRevision = (db.$client.prepare("select id from portal_revisions where portal_id = ? order by number desc").get(treasury) as { id: number }).id;

      const ledger = application(db, "Ledger", "wap_v2ledger00000000");
      const activity = application(db, "Activity", "wap_v2activity000000");
      const statements = application(db, "Statements", "wap_v2statements0000");
      const cards = application(db, "Cards", "wap_v2cards000000000");
      const inMarkets = { portal: markets, portalRevision: marketsRevision };
      const ledgerPlacement = place(db, { ...inMarkets, application: ledger.application, applicationRevision: ledger.revision, label: "Ledger", routes: { prod: "/ledger", uat: "/ledger-uat" }, createdAt: AT + 1 }, 1);
      const activityPlacement = place(db, { ...inMarkets, application: activity.application, applicationRevision: activity.revision, label: "Activity", routes: { uat: "/activity" }, createdAt: AT + 2 }, 2);
      place(db, { ...inMarkets, application: statements.application, applicationRevision: statements.revision, label: "Statements", routes: { uat: "/ledger" }, createdAt: AT + 3 }, 3);
      place(db, { portal: treasury, portalRevision: treasuryRevision, application: cards.application, applicationRevision: cards.revision, label: "Cards", createdAt: AT + 4 }, 4);
      place(db, { ...inMarkets, application: cards.application, applicationRevision: cards.revision, label: "Cards", routes: { prod: "/cards" }, createdAt: AT + 5 }, 5);

      for (const [environment, chosen] of [["prod", ledgerPlacement], ["uat", activityPlacement]] as const) {
        insert(db, "portal_default_routes", { portal_id: markets, environment, sequence: 0, placement_id: chosen.placement, decision_id: chosen.decision, actor: "cy@example.com", attribution: "unverified", assigned_at: AT });
      }

      const workspace = insert(db, "demo_workspaces", { key_digest: "a".repeat(64), created_at: AT, last_seen_at: AT });
      const imported = insert(db, "demo_applications", { public_id: "app_v2imported000000", workspace_id: workspace, template_slug: "payments-workspace", name: "Imported payees", environment: "dev", bitbucket_project: "PAY", bitbucket_repository: "payees", origin: "import", created_at: AT });
      insert(db, "demo_applications", { public_id: "app_v2template000000", workspace_id: workspace, template_slug: "payments-workspace", name: "Payments workspace", environment: "sandbox", origin: "template", created_at: AT });
      const thread = insert(db, "demo_threads", { public_id: "thr_v2imported000000", application_id: imported, view_workspace_id: workspace, route: "/", member: "payees", member_version: "1", anchor: "button", offset_x: 0.5, offset_y: 0.5, created_at: AT });
      insert(db, "demo_comments", { public_id: "cmt_v2imported000000", thread_id: thread, author_workspace_id: workspace, author_name: "Ana", body: "Looks good", created_at: AT });
      insert(db, "demo_shares", { token_digest: "b".repeat(64), application_id: imported, view_workspace_id: workspace, state: "{}", created_at: AT });

      for (const trigger of triggers) db.$client.exec(trigger.sql);
    })();
  } finally {
    db.$client.pragma("foreign_keys = ON");
  }
  const violations = db.$client.pragma("foreign_key_check") as unknown[];
  if (violations.length > 0) throw new Error(`The v2 fixture breaks ${violations.length} foreign keys`);
}

/** The v1 and v2 fixtures at LAST_REVISIONED_MIGRATION, before make-applications-first-class. */
export function v2Database(): Db {
  const db = v1Database();
  const folder = migrationFolderAt(LAST_REVISIONED_MIGRATION);
  try {
    migrateDatabase(db, folder);
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
  seedV2(db);
  return db;
}
