import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db/client";
import { createTestDb, rawRun } from "../support/db";

/*
 * The onboarding tables enforce their own rules (tasks 2.1 to 2.3): these
 * tests write raw SQL, bypassing every domain function, to prove each rule
 * holds at the database layer.
 */

const DIGEST = "a".repeat(64);
const now = 1_790_000_000_000;

function insert(db: Db, statement: string, ...params: unknown[]): number {
  return Number(db.$client.prepare(statement).run(...params).lastInsertRowid);
}

function value<T>(db: Db, statement: string, ...params: unknown[]): T {
  return db.$client.prepare(statement).get(...params) as T;
}

/** Identities and submitted revisions, written in the order the domain writes them. */
function world(db: Db) {
  const source = insert(db, "insert into repository_sources (public_id, name, clone_url, canonical_url, created_at, updated_at) values ('src_aaaaaaaaaaaaaaaa', 'payee', 'https://git.example.com/pay/payee.git', 'https://git.example.com/pay/payee', 1, 1)");
  const portal = insert(db, "insert into portals (public_id, label, label_key, created_at, seal_id) values ('ptl_aaaaaaaaaaaaaaaa', 'Access', 'access', 1, '88001')");
  const portalRevision = insert(db, "insert into portal_revisions (portal_id, number, document, created_by, created_at, updated_at) values (?, 1, '{}', 'ana', 1, 1)", portal);
  insert(db, "insert into portal_environments (portal_revision_id, environment, enabled) values (?, 'prod', 1)", portalRevision);
  insert(db, "insert into portal_menu_groups (portal_revision_id, key, parent_key, label, ordering) values (?, 'payments', NULL, 'Payments', 1)", portalRevision);
  rawRun(db, "update portal_revisions set state = 'submitted', digest = ?, submitted_by = 'ana', submitted_at = 2, owner_team = 'Access Platform', environment_catalog_source = 'fallback', environment_catalog_digest = ?, lock_version = 1 where id = ?", DIGEST, DIGEST, portalRevision);

  const mfe = (publicId: string, name: string) => {
    const id = insert(db, "insert into microfrontends (public_id, name, seal_id, created_at) values (?, ?, '88001', 1)", publicId, name);
    const revision = insert(db, "insert into microfrontend_revisions (microfrontend_id, number, document, created_by, created_at, updated_at) values (?, 1, '{}', 'ana', 1, 1)", id);
    rawRun(db, "update microfrontend_revisions set state = 'submitted', digest = ?, submitted_by = 'ana', submitted_at = 2, name = ?, owner_team = 'Payee', repository_source_id = ?, rendering = '{\"module_federation_2\":{\"exposes\":[\"./App\"]}}', lock_version = 1 where id = ?", DIGEST, name, source, revision);
    return id;
  };
  const search = mfe("mfe_aaaaaaaaaaaaaaaa", "Payee search");
  const details = mfe("mfe_aaaaaaaaaaaaaaab", "Payee details");

  const application = insert(db, "insert into applications (public_id, seal_id, name, created_at) values ('wap_aaaaaaaaaaaaaaaa', '88001', 'Payments workspace', 1)");
  const draft = (number = 1) => insert(db, "insert into application_revisions (application_id, number, document, created_by, created_at, updated_at) values (?, ?, '{}', 'ana', 1, 1)", application, number);
  return { source, portal, portalRevision, search, details, application, draft };
}

function submitApplication(db: Db, revision: number) {
  rawRun(db, "update application_revisions set state = 'submitted', digest = ?, submitted_by = 'ana', submitted_at = 2, name = 'Payments workspace', owner_team = 'Payments', environment_catalog_source = 'fallback', environment_catalog_digest = ?, lock_version = lock_version + 1 where id = ?", DIGEST, DIGEST, revision);
}

const target = (db: Db, revision: number, columns: Record<string, unknown>) => {
  const all = { kind: "mfe", microfrontend_id: null, rendering_mode: "module_federation_2", confirmation: "explicit", confirmed_by: "ana", confirmed_at: now, ...columns };
  const names = Object.keys(all);
  return insert(db, `insert into application_launch_targets (application_revision_id, ${names.join(", ")}) values (?, ${names.map(() => "?").join(", ")})`, revision, ...Object.values(all));
};

describe("onboarding storage", () => {
  let db: Db;

  beforeEach(() => {
    db = createTestDb();
  });

  describe("identities (task 2.1)", () => {
    it("lets Portals, Web Applications, and MFEs share SEAL IDs, indexed but never unique", () => {
      const { portal } = world(db);
      insert(db, "insert into portals (public_id, label, label_key, created_at, seal_id) values ('ptl_aaaaaaaaaaaaaaab', 'Markets', 'markets', 1, '88001')");
      insert(db, "insert into applications (public_id, seal_id, name, created_at) values ('wap_aaaaaaaaaaaaaaab', '88001', 'Payments reporting', 1)");

      for (const table of ["portals", "applications", "microfrontends"]) {
        expect(value<{ n: number }>(db, `select count(*) as n from ${table} where seal_id = '88001'`).n, table).toBe(2);
        const indexes = db.$client.prepare(`pragma index_list(${table})`).all() as { name: string; unique: number }[];
        expect(indexes.find((index) => index.name === `${table}_seal_id`), table).toMatchObject({ unique: 0 });
      }
      rawRun(db, "update portals set seal_id = '88009' where id = ?", portal);
      expect(value(db, "select public_id as publicId, label from portals where id = ?", portal)).toEqual({ publicId: "ptl_aaaaaaaaaaaaaaaa", label: "Access" });
      expect(() => rawRun(db, "update portals set seal_id = ' 88009' where id = ?", portal)).toThrow(/portals_seal_id/);
      expect(() => insert(db, "insert into microfrontends (public_id, name, seal_id, created_at) values ('mfe_aaaaaaaaaaaaaaac', 'X', '', 1)")).toThrow(/microfrontends_seal_id/);
    });

    it("keeps public IDs stable and prefixed", () => {
      const { search, application } = world(db);
      expect(() => insert(db, "insert into microfrontends (public_id, name, created_at) values ('wap_aaaaaaaaaaaaaaaz', 'X', 1)")).toThrow(/microfrontends_public_id/);
      expect(() => insert(db, "insert into microfrontends (public_id, name, created_at) values ('mfe_aaaaaaaaaaaaaaaz', '  ', 1)")).toThrow(/microfrontends_name/);
      expect(() => rawRun(db, "update microfrontends set public_id = 'mfe_bbbbbbbbbbbbbbbb' where id = ?", search)).toThrow(/keeps its public ID/);
      expect(() => rawRun(db, "update applications set public_id = 'wap_bbbbbbbbbbbbbbbb' where id = ?", application)).toThrow(/keeps its public ID/);
    });

    it("retires without deleting, and a retired record stays retired", () => {
      const { portal, search, application, source } = world(db);
      for (const [table, id] of [["portals", portal], ["applications", application], ["microfrontends", search]] as const) {
        expect(() => rawRun(db, `delete from ${table} where id = ?`, id), table).toThrow(/retained/);
        expect(() => rawRun(db, `update ${table} set lifecycle = 'paused' where id = ?`, id), table).toThrow(/CHECK constraint failed/);
        rawRun(db, `update ${table} set lifecycle = 'retired' where id = ?`, id);
        expect(() => rawRun(db, `update ${table} set lifecycle = 'draft' where id = ?`, id), table).toThrow(/stays retired/);
      }
      expect(() => rawRun(db, "delete from repository_sources where id = ?", source)).toThrow(/repository_sources/);
    });
  });

  describe("revisions (task 2.2)", () => {
    it("keeps one Draft per record, numbers revisions in order, and freezes submitted ones", () => {
      const { application, draft, portal, portalRevision } = world(db);
      const first = draft();
      expect(() => draft(2)).toThrow(/UNIQUE constraint failed: application_revisions.application_id/);
      expect(() => insert(db, "insert into portal_revisions (portal_id, number, document, created_by, created_at, updated_at) values (?, 3, '{}', 'ana', 1, 1)", portal)).toThrow(/next number/);
      expect(() => rawRun(db, "update portal_revisions set lock_version = lock_version + 1 where id = ?", portalRevision)).toThrow(/never changed/);
      expect(() => rawRun(db, "update application_revisions set lock_version = lock_version + 2 where id = ?", first)).toThrow(/advances its lock version/);
      expect(() => rawRun(db, "update application_revisions set state = 'submitted', lock_version = lock_version + 1 where id = ?", first)).toThrow(/a submitted revision has one launch target/);
      expect(() => rawRun(db, "update applications set active_revision_id = ? where id = ?", first, application)).toThrow(/active revision is a submitted one/);
      rawRun(db, "update applications set draft_revision_id = ? where id = ?", first, application);
      rawRun(db, "update portals set active_revision_id = ? where id = ?", portalRevision, portal);
      expect(() => insert(db, "insert into portal_revisions (portal_id, number, document, created_by, created_at, updated_at) values (?, 2, '[1]', 'ana', 1, 1)", portal)).toThrow(/portal_revisions_document/);
    });

    it("requires a submitted Application revision to have its launch target, and an MFE target its entry", () => {
      const { draft, search } = world(db);
      const revision = draft();
      expect(() => submitApplication(db, revision)).toThrow(/one launch target/);
      target(db, revision, { microfrontend_id: search, exposed_module: "./App" });
      expect(() => submitApplication(db, revision)).toThrow(/entry binding/);
      insert(db, "insert into application_components (application_revision_id, microfrontend_id, role, required) values (?, ?, 'entry', 1)", revision, search);
      submitApplication(db, revision);
      expect(() => target(db, revision, { microfrontend_id: search })).toThrow(/frozen with it/);
      expect(() => rawRun(db, "delete from application_components")).toThrow(/retained/);
      expect(() => rawRun(db, "update application_components set required = 0")).toThrow(/never changed/);
    });
  });

  describe("normalized configuration (task 2.3)", () => {
    it("allows exactly one launch source per revision, with the location its rendering mode needs", () => {
      const { draft, search } = world(db);
      const revision = draft();
      const refused = (columns: Record<string, unknown>) => () => target(db, revision, columns);
      expect(refused({ kind: "mfe" })).toThrow(/application_launch_targets_source/);
      expect(refused({ kind: "external", microfrontend_id: search, rendering_mode: "iframe", document_url: "https://payments.example.com/app" })).toThrow(/application_launch_targets_source/);
      expect(refused({ kind: "mfe", microfrontend_id: search, rendering_mode: "iframe", document_url: "https://payments.example.com/app" })).toThrow(/application_launch_targets_source/);
      expect(refused({ kind: "external", rendering_mode: "esm", module_url: "https://cdn.example.com/app.js" })).toThrow(/application_launch_targets_source/);
      expect(refused({ kind: "external", rendering_mode: "module_federation_2", manifest_url: "https://cdn.example.com/mf-manifest.json" })).toThrow(/application_launch_targets_source/);
      expect(refused({ kind: "external", rendering_mode: "iframe", document_url: "http://payments.example.com/app" })).toThrow(/application_launch_targets_urls/);
      expect(refused({ kind: "external", rendering_mode: "iframe", document_url: "https://ci:token@payments.example.com/app" })).toThrow(/application_launch_targets_urls/);
      expect(refused({ kind: "external", rendering_mode: "iframe", document_url: "https://payments.example.com/app#top" })).toThrow(/application_launch_targets_urls/);
      expect(refused({ kind: "external", rendering_mode: "teleport", document_url: "https://payments.example.com/app" })).toThrow(/CHECK constraint failed/);
      target(db, revision, { kind: "external", rendering_mode: "esm", module_url: "https://cdn.example.com/@payments/app.js", exported_module: "mount" });
      expect(refused({ kind: "external", rendering_mode: "iframe", document_url: "https://payments.example.com/app" })).toThrow(/UNIQUE constraint failed: application_launch_targets.application_revision_id/);
    });

    it("binds an MFE target as the one entry, every other MFE as a child with its own mount, and an external target to children only", () => {
      const { draft, search, details, application } = world(db);
      const managed = draft();
      target(db, managed, { microfrontend_id: search, exposed_module: "./App" });
      const component = (revision: number, mfe: number, role: string, mountKind: string | null = null, mountKey: string | null = null) =>
        insert(db, "insert into application_components (application_revision_id, microfrontend_id, role, mount_kind, mount_key, required) values (?, ?, ?, ?, ?, 1)", revision, mfe, role, mountKind, mountKey);
      expect(() => component(managed, details, "entry")).toThrow(/entry binding is the MFE the revision launches/);
      expect(() => component(managed, search, "child", "slot", "sidebar")).toThrow(/is its entry, not a child/);
      component(managed, search, "entry");
      expect(() => component(managed, details, "child")).toThrow(/application_components_mount/);
      expect(() => component(managed, details, "child", "route", "details")).toThrow(/application_components_mount/);
      component(managed, details, "child", "route", "/details");
      submitApplication(db, managed);

      // The same MFE is an entry in one Application and a child in another.
      const external = insert(db, "insert into application_revisions (application_id, number, document, created_by, created_at, updated_at) values (?, 2, '{}', 'ana', 1, 1)", application);
      target(db, external, { kind: "external", rendering_mode: "iframe", document_url: "https://payments.example.com/app" });
      expect(() => component(external, search, "entry")).toThrow(/an external launch target has none/);
      component(external, search, "child", "slot", "sidebar");
      expect(() => component(external, details, "child", "slot", "sidebar")).toThrow(/UNIQUE constraint failed: application_components.application_revision_id, application_components.mount_kind, application_components.mount_key/);
      component(external, details, "child", "slot", "footer");
      submitApplication(db, external);
      expect(db.$client.prepare("select microfrontend_id as mfe, role from application_components where microfrontend_id = ? order by id").all(search)).toEqual([
        { mfe: search, role: "entry" },
        { mfe: search, role: "child" },
      ]);
      expect(() => rawRun(db, "delete from microfrontends where id = ?", search)).toThrow(/retained/);
    });

    it("keeps a Portal revision's environments and menu groups within it", () => {
      const { portal } = world(db);
      const revision = insert(db, "insert into portal_revisions (portal_id, number, document, created_by, created_at, updated_at) values (?, 2, '{}', 'ana', 1, 1)", portal);
      const env = (environment: string) => insert(db, "insert into portal_environments (portal_revision_id, environment, enabled) values (?, ?, 1)", revision, environment);
      env("uat");
      env("prod");
      expect(() => env("prod")).toThrow(/UNIQUE constraint failed: portal_environments.portal_revision_id, portal_environments.environment/);
      expect(() => env("Dev")).toThrow(/portal_environments_environment/);
      const group = (key: string, parent: string | null) => insert(db, "insert into portal_menu_groups (portal_revision_id, key, parent_key, label, ordering) values (?, ?, ?, 'Group', 1)", revision, key, parent);
      group("payments", null);
      group("payments-tools", "payments");
      expect(() => group("orphan", "missing")).toThrow(/FOREIGN KEY/);
      expect(() => group("Payments", null)).toThrow(/portal_menu_groups_key/);
    });

    it("records placements per Application revision, decides them in order, and lets one active route hold a Portal environment's path", () => {
      const { portal, portalRevision, application, draft } = world(db);
      const revision = draft();
      target(db, revision, { kind: "external", rendering_mode: "iframe", document_url: "https://payments.example.com/app" });
      const placement = (publicId: string, app = application) => insert(db, "insert into application_placements (public_id, application_id, portal_id, created_at) values (?, ?, ?, 1)", publicId, app, portal);
      const request = (placementId: number, route: string, revisionId = revision) =>
        insert(db, "insert into placement_requests (placement_id, application_revision_id, route, label, ordering, entitlements, entitlements_digest, default_requested, created_at) values (?, ?, ?, 'Payments', 1, '{}', ?, 0, 1)", placementId, revisionId, route, DIGEST);
      const payments = placement("plc_aaaaaaaaaaaaaaaa");
      const reports = placement("plc_aaaaaaaaaaaaaaab");
      const paymentsRequest = request(payments, "/payments");
      const reportsRequest = request(reports, "/payments/reports");
      expect(() => request(payments, "/payments")).toThrow(/UNIQUE constraint failed: placement_requests.placement_id, placement_requests.application_revision_id/);
      for (const [index, route] of ["payments", "/payments/", "/payments//x", "/payments?tab=1", "/pay ments", "/payments#top"].entries()) {
        expect(() => request(placement(`plc_bad${index}aaaaaaaaaaaa`), route), route).toThrow(/placement_requests_route/);
      }
      const other = insert(db, "insert into applications (public_id, seal_id, name, created_at) values ('wap_aaaaaaaaaaaaaaab', '88001', 'Payments reporting', 1)");
      expect(() => request(placement("plc_aaaaaaaaaaaaaaac", other), "/reports")).toThrow(/a revision of its own application/);
      insert(db, "insert into placement_request_environments (placement_request_id, environment) values (?, 'prod')", paymentsRequest);
      expect(() => insert(db, "insert into placement_request_environments (placement_request_id, environment) values (?, 'prod')", paymentsRequest)).toThrow(/UNIQUE/);
      submitApplication(db, revision);
      expect(() => request(placement("plc_aaaaaaaaaaaaaaad"), "/late")).toThrow(/frozen with it/);

      const decide = (requestId: number, placementId: number, sequence: number, decision: string, extra: Record<string, unknown> = {}) => {
        const all = { reason: null, accepted_route: null, accepted_label: null, accepted_ordering: null, accepted_entitlements: null, accepted_defaults: null, ...extra };
        return insert(
          db,
          `insert into placement_decisions (public_id, placement_id, placement_request_id, portal_revision_id, application_revision_id, sequence, decision, ${Object.keys(all).join(", ")}, actor, attribution, decided_at)
            values (?, ?, ?, ?, ?, ?, ?, ${Object.keys(all).map(() => "?").join(", ")}, 'cy', 'unverified', ?)`,
          `pdc_${String(requestId).padStart(2, "0")}${sequence}${decision.slice(0, 2)}aaaaaaaaaaa`.slice(0, 20),
          placementId,
          requestId,
          portalRevision,
          revision,
          sequence,
          decision,
          ...Object.values(all),
          now,
        );
      };
      const approval = { accepted_route: "/payments", accepted_label: "Payments", accepted_ordering: 1, accepted_entitlements: "{}", accepted_defaults: "[]" };
      expect(() => decide(paymentsRequest, payments, 1, "approve", approval)).toThrow(/follows the latest one/);
      expect(() => decide(paymentsRequest, payments, 0, "approve")).toThrow(/placement_decisions_accepted/);
      expect(() => decide(paymentsRequest, payments, 0, "reject")).toThrow(/placement_decisions_reason/);
      expect(() => decide(paymentsRequest, reports, 0, "approve", approval)).toThrow(/names its request's placement/);
      expect(() => decide(paymentsRequest, payments, 0, "retire", { reason: "No longer needed" })).toThrow(/a pending request can be approved/);
      const approved = decide(paymentsRequest, payments, 0, "approve", approval);
      expect(() => decide(paymentsRequest, payments, 1, "approve", approval)).toThrow(/an approved one retired or withdrawn/);
      const rejected = decide(reportsRequest, reports, 0, "reject", { reason: "Use the Markets portal" });
      expect(() => decide(reportsRequest, reports, 1, "withdraw")).toThrow(/nothing follows the others/);
      expect(() => rawRun(db, "update placement_decisions set reason = 'x'")).toThrow(/never changed/);

      const route = (placementId: number, decision: number, path: string) =>
        insert(db, "insert into placement_routes (placement_id, decision_id, portal_id, application_id, environment, route, activated_at) values (?, ?, ?, ?, 'prod', ?, 1)", placementId, decision, portal, application, path);
      const active = route(payments, approved, "/payments");
      expect(() => route(reports, rejected, "/payments/reports")).toThrow(/comes from an approval of its own placement/);
      expect(() => route(payments, approved, "/payments")).toThrow(/UNIQUE constraint failed: placement_routes.portal_id, placement_routes.environment, placement_routes.route/);
      route(payments, approved, "/payments/home");
      expect(() => rawRun(db, "update placement_routes set route = '/elsewhere' where id = ?", active)).toThrow(/only ever deactivated/);

      const assign = (sequence: number, placementId: number | null, environment = "prod") => insert(db, "insert into portal_default_routes (portal_id, environment, sequence, placement_id, actor, attribution, assigned_at) values (?, ?, ?, ?, 'cy', 'unverified', 1)", portal, environment, sequence, placementId);
      expect(() => assign(0, reports)).toThrow(/approved placement active in that Portal environment/);
      expect(() => assign(0, payments, "uat")).toThrow(/approved placement active/);
      assign(0, payments);
      expect(() => assign(0, null)).toThrow(/assigned after the latest one/);
      rawRun(db, "update placement_routes set active = 0, deactivated_at = 2 where id = ?", active);
      route(payments, approved, "/payments");
      expect(() => rawRun(db, "update placement_routes set active = 1, deactivated_at = NULL where id = ?", active)).toThrow(/only ever deactivated/);
      expect(() => rawRun(db, "delete from portal_default_routes")).toThrow(/retained/);
    });

    it("maps external resources explicitly, one per record and resource, and keeps every observation and read", () => {
      const { portal, search, application } = world(db);
      const reference = (system: string, type: string, externalId: string, column: string, id: number, subject: string, environment: string | null = null) =>
        insert(
          db,
          `insert into external_references (public_id, system, resource_type, external_id, environment, ${column}, subject, source, provided_by, attribution, recorded_at) values (?, ?, ?, ?, ?, ?, ?, 'person', 'ana', 'unverified', 1)`,
          `xrf_${externalId.replace(/[^a-z0-9]/g, "").padEnd(16, "a")}`.slice(0, 20),
          system,
          type,
          externalId,
          environment,
          id,
          subject,
        );
      const channel = reference("studio", "channel", "chan-1", "portal_id", portal, `portal:${portal}`);
      expect(() => reference("studio", "channel", "chan-2", "portal_id", portal, `portal:${portal}`)).toThrow(/UNIQUE constraint failed/);
      expect(() => reference("studio", "channel", "chan-3", "application_id", application, `application:${application}`)).toThrow(/external_references_mapping/);
      expect(() => reference("studio", "module", "mod-1", "microfrontend_id", search, `portal:${portal}`)).toThrow(/external_references_subject/);
      expect(() => reference("cdaas", "application_view", "payee", "microfrontend_id", search, `microfrontend:${search}`)).toThrow(/external_references_mapping/);
      const view = reference("cdaas", "application_view", "payee/search", "microfrontend_id", search, `microfrontend:${search}`);
      expect(() => rawRun(db, "update external_references set external_id = 'chan-9' where id = ?", channel)).toThrow(/only ever retired/);
      rawRun(db, "update external_references set retired_at = 5 where id = ?", channel);
      reference("studio", "channel", "chan-2", "portal_id", portal, `portal:${portal}`);

      const observe = (outcome: string, projection: string | null) =>
        insert(db, "insert into external_observations (reference_id, outcome, contract_digest, projection, projection_digest, first_observed_at) values (?, ?, ?, ?, ?, 1)", view, outcome, DIGEST, projection, "b".repeat(64));
      const found = observe("found", '{"appId":"payee"}');
      expect(() => observe("found", '{"appId":"payee"}')).toThrow(/UNIQUE constraint failed: external_observations/);
      expect(() => observe("not_found", '{"appId":"payee"}')).toThrow(/external_observations_projection/);
      const read = (observation: number | null, outcome: string, error: string | null) => insert(db, "insert into external_reads (reference_id, observation_id, outcome, error, read_at) values (?, ?, ?, ?, 1)", view, observation, outcome, error);
      read(found, "found", null);
      read(found, "found", null);
      read(null, "unavailable", "CDaaS didn't answer in time");
      expect(() => read(null, "found", null)).toThrow(/external_reads_observation/);
      expect(() => read(null, "unavailable", null)).toThrow(/external_reads_error/);
      expect(value<{ n: number }>(db, "select count(*) as n from external_reads").n).toBe(3);
      expect(() => rawRun(db, "delete from external_reads")).toThrow(/retained/);
    });

    it("keeps validations and lifecycle events for exactly one record each", () => {
      const { portal, portalRevision, application } = world(db);
      expect(() => insert(db, "insert into onboarding_validations (subject, portal_revision_id, application_revision_id, document_digest, blocking, issues, evaluated_at) values ('portal', ?, NULL, ?, 0, '[]', 1)", portalRevision, "z".repeat(64))).toThrow(/document_digest/);
      insert(db, "insert into onboarding_validations (subject, portal_revision_id, document_digest, blocking, issues, evaluated_at) values ('portal', ?, ?, 0, '[]', 1)", portalRevision, DIGEST);
      expect(() => insert(db, "insert into onboarding_validations (subject, application_revision_id, document_digest, blocking, issues, evaluated_at) values ('portal', ?, ?, 0, '[]', 1)", portalRevision, DIGEST)).toThrow(/onboarding_validations_subject/);
      expect(() => insert(db, "insert into onboarding_events (subject, portal_id, application_id, event, actor, attribution, occurred_at) values ('portal', ?, ?, 'created', 'ana', 'unverified', 1)", portal, application)).toThrow(/onboarding_events_subject/);
      expect(() => insert(db, "insert into onboarding_events (subject, portal_id, event, actor, attribution, occurred_at) values ('portal', ?, 'retired', 'ana', 'unverified', 1)", portal)).toThrow(/onboarding_events_reason/);
      expect(() => insert(db, "insert into onboarding_events (subject, portal_id, event, actor, attribution, occurred_at) values ('portal', ?, 'created', 'ana', 'verified', 1)", portal)).toThrow(/onboarding_events_attribution/);
      insert(db, "insert into onboarding_events (subject, portal_id, event, actor, attribution, occurred_at) values ('portal', ?, 'created', 'ana', 'unverified', 1)", portal);
      expect(() => rawRun(db, "update onboarding_events set actor = 'ben'")).toThrow(/never changed/);
    });
  });
});
