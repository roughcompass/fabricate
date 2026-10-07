import type { JsonObject } from "@repo-facts/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db/client";
import { ValidationError } from "@/lib/db/errors";
import {
  applicationDraftFromV1,
  applicationDraftSchema,
  canonicalDocument,
  documentDigest,
  draftFromSubmitted,
  draftOfDocument,
  microfrontendDraftFromV1,
  microfrontendDraftSchema,
  portalDraftFromV1,
  portalDraftSchema,
  renderingFromV1,
  resolveLegacyIssues,
} from "@/lib/onboarding/formats";
import { migratedV1Database, v1Snapshot } from "../support/onboarding-v1";

/*
 * Document formats (tasks 2.3 and 2.4): v1 documents read as they were
 * written, with their digests; v2 documents in one canonical form; and v1
 * Drafts converted to v2, keeping what v2 no longer collects as history.
 */

type Kind = "portal" | "application" | "microfrontend";
const TABLES: Record<Kind, string> = { portal: "portal_revisions", application: "application_revisions", microfrontend: "microfrontend_revisions" };

describe("document formats", () => {
  let db: Db;
  const revisionOf = (kind: Kind, id: number) => {
    const row = db.$client.prepare(`select number, format_version as formatVersion, document, digest from ${TABLES[kind]} where id = ?`).get(id) as { number: number; formatVersion: 1 | 2; document: string; digest: string | null };
    return { ...row, document: JSON.parse(row.document) as JsonObject };
  };

  beforeEach(() => {
    db = migratedV1Database();
  });

  afterEach(() => db.$client.close());

  describe("v1 documents", () => {
    it("parse under their v1 schemas and keep their digests", () => {
      for (const kind of Object.keys(TABLES) as Kind[]) {
        const submitted = db.$client.prepare(`select id from ${TABLES[kind]} where state = 'submitted'`).all() as { id: number }[];
        expect(submitted.length, kind).toBeGreaterThan(0);
        for (const { id } of submitted) {
          const revision = revisionOf(kind, id);
          expect(canonicalDocument(kind, 1, revision.document).digest, `${kind} ${id}`).toBe(revision.digest);
          expect(documentDigest(revision.document), `${kind} ${id}`).toBe(revision.digest);
        }
      }
    });

    it("refuse a v1 document with a field v1 never had", () => {
      expect(() => canonicalDocument("portal", 1, { ...revisionOf("portal", 1).document, launchPad: true })).toThrow(ValidationError);
    });
  });

  describe("v2 documents", () => {
    const portal = { ownerTeam: "Access Platform", sealId: "88001", environments: ["prod", "uat"], menu: [{ key: "payments", label: "Payments", parent: null, order: 1 }, { key: "admin", label: "Admin", parent: null, order: 2 }] };
    const application = {
      name: "Payee hub",
      ownerTeam: "Payments",
      sealId: null,
      launch: { kind: "mfe", microfrontend: "mfe_aaaaaaaaaaaaaaaa", mode: "module_federation_2", documentUrl: null, moduleUrl: null, exportedModule: null, manifestUrl: null, exposedModule: "./App", sandbox: [], permissions: [], integrity: null },
      confirmation: { kind: "explicit", candidate: null, by: "ana", at: "2026-10-04T08:00:00.000Z", launchDigest: "c".repeat(64) },
      children: [
        { microfrontend: "mfe_bbbbbbbbbbbbbbbb", mountKind: "slot", mountKey: "search", required: true, module: "./Widget" },
        { microfrontend: "mfe_cccccccccccccccc", mountKind: "route", mountKey: "/details", required: false, module: null },
      ],
      placements: [
        { placement: "plc_bbbbbbbbbbbbbbbb", portal: "ptl_bbbbbbbbbbbbbbbb", menuParent: null, route: "/payee", label: "Payees", order: 1, environments: ["uat", "prod"], entitlements: { codes: ["PAY", "ACCESS"], operator: "all" }, defaultRequested: false },
        { placement: null, portal: "ptl_aaaaaaaaaaaaaaaa", menuParent: "payments", route: "/payee", label: "Payees", order: 1, environments: ["prod"], entitlements: { codes: [], operator: "any" }, defaultRequested: true },
      ],
    };
    const mfe = { name: "Payee search", ownerTeam: "Payee", sealId: "88001", repository: "src_aaaaaaaaaaaaaaaa", workspacePath: "apps/search", cdaas: { appId: "payee", viewId: "search" }, rendering: { iframe: null, esm: { exports: ["./Widget", "./Search"] }, module_federation_2: { exposes: ["./Search"] } } };
    const reversed = <T extends Record<string, unknown>>(value: T): T => Object.fromEntries(Object.entries(value).reverse()) as T;

    it("give equivalent documents one canonical text and digest, whatever order they were written in", () => {
      const same = (kind: Kind, a: unknown, b: unknown) => expect(canonicalDocument(kind, 2, a).digest, kind).toBe(canonicalDocument(kind, 2, b).digest);
      same("portal", portal, reversed({ ...portal, environments: ["uat", "prod", "uat"], menu: [...portal.menu].reverse() }));
      same("application", application, reversed({ ...application, children: [...application.children].reverse(), placements: [...application.placements].reverse().map((placement) => ({ ...placement, environments: [...placement.environments].reverse(), entitlements: { ...placement.entitlements, codes: [...placement.entitlements.codes].reverse() } })) }));
      same("microfrontend", mfe, reversed({ ...mfe, rendering: { ...mfe.rendering, esm: { exports: ["./Search", "./Widget"] } } }));
      expect(canonicalDocument("portal", 2, portal).value).toMatchObject({ environments: ["prod", "uat"], menu: [{ key: "admin" }, { key: "payments" }] });
      expect(canonicalDocument("portal", 2, portal).digest).not.toBe(canonicalDocument("portal", 2, { ...portal, environments: ["prod"] }).digest);
    });

    it("refuse v1 values and Draft-only history", () => {
      expect(() => canonicalDocument("portal", 2, { ...portal, runtimes: ["studio-shell"] })).toThrow(ValidationError);
      expect(() => canonicalDocument("portal", 2, { ...portal, legacy: null })).toThrow(ValidationError);
      expect(() => canonicalDocument("application", 2, { ...application, requiredCapabilities: [] })).toThrow(ValidationError);
      expect(() => canonicalDocument("microfrontend", 2, { ...mfe, contract: {} })).toThrow(ValidationError);
      expect(() => canonicalDocument("microfrontend", 2, { ...mfe, rendering: { iframe: null, esm: null, module_federation_2: null } })).toThrow(/at least one rendering mode/);
    });
  });

  describe("v1 to v2 Drafts", () => {
    const named = (table: string, column: string, name: string) => (db.$client.prepare(`select id from ${table} where ${column} = ?`).get(name) as { id: number }).id;
    const draftId = (table: string, key: string, owner: number) => (db.$client.prepare(`select id from ${table} where ${key} = ? and state = 'draft'`).get(owner) as { id: number }).id;

    it("carries a Portal's team-owned values and keeps its runtimes, entitlements, and contract as history", () => {
      const access = draftId("portal_revisions", "portal_id", named("portals", "label", "Access"));
      const v1 = revisionOf("portal", access);
      const draft = draftOfDocument("portal", v1);

      expect(portalDraftSchema.parse(draft)).toEqual(draft);
      expect(draft).toMatchObject({ ownerTeam: "Access Platform", sealId: "88001", environments: ["uat", "prod"], menu: [{ key: "payments", label: "Payments" }] });
      expect(draft.legacy).toMatchObject({ fromRevision: 2, issues: [], values: { runtimes: ["studio-shell", "studio-shell-2"], contract: { capabilities: expect.any(Array) } } });
      expect(draft.legacy!.values.environments).toContainEqual({ key: "prod", runtime: "studio-shell", enabled: true, entitlements: null, inheritFrom: "uat" });
      expect(draft.legacy!.values.environments).toContainEqual({ key: "dr", runtime: "studio-shell", enabled: false, entitlements: { codes: [], operator: "any" }, inheritFrom: null });
      expect(Object.keys(draft)).not.toContain("runtimes");
      expect(portalDraftFromV1(revisionOf("portal", 1).document, 1).environments).toEqual(["prod", "uat"]);
    });

    it("turns an Application's global environments, required capabilities, host contract, and host configuration into history", () => {
      const hub = draftId("application_revisions", "application_id", named("applications", "name", "Payee hub"));
      const draft = draftOfDocument("application", revisionOf("application", hub));
      expect(applicationDraftSchema.parse(draft)).toEqual(draft);
      expect(draft.children).toEqual([{ microfrontend: expect.stringMatching(/^mfe_/), mountKind: "slot", mountKey: "search", required: true, module: null }]);
      expect(draft.placements.map((placement) => [placement.route, placement.environments])).toEqual([
        ["/payee", ["prod", "uat"]],
        ["/payee", ["prod", "uat"]],
      ]);
      expect(draft.legacy).toMatchObject({ fromRevision: 2, issues: [], values: { environments: ["prod", "uat"], requiredCapabilities: ["navigation", "theme"], hostContract: null, hostConfiguration: [{ microfrontend: expect.stringMatching(/^mfe_/), hostConfiguration: { pageSize: 25 } }] } });

      const reporting = revisionOf("application", named("application_revisions", "name", "Payments reporting"));
      const fromReporting = applicationDraftFromV1(reporting.document, reporting.number);
      expect(fromReporting.launch).toMatchObject({ kind: "external", mode: "iframe", documentUrl: "https://payments.example.com/reports", sandbox: ["allow-scripts"] });
      expect(fromReporting.legacy!.values.hostContract).toMatchObject({ provides: { capabilities: ["navigation"] } });
    });

    it("derives MFE rendering metadata where exports are unambiguous, and asks the team where they aren't", () => {
      const hub = revisionOf("microfrontend", named("microfrontend_revisions", "name", "Payee hub"));
      const fromHub = microfrontendDraftFromV1(hub.document, hub.number);
      expect(microfrontendDraftSchema.parse(fromHub)).toEqual(fromHub);
      expect(fromHub.rendering).toEqual({ iframe: null, esm: null, module_federation_2: { exposes: ["./App"] } });
      expect(fromHub.legacy).toMatchObject({ issues: [], values: { contract: { requires: { events: ["portal.navigate"] }, shared: [{ name: "react" }] } } });

      const frames = draftOfDocument("microfrontend", revisionOf("microfrontend", draftId("microfrontend_revisions", "microfrontend_id", named("microfrontends", "name", "Payee frames"))));
      expect(frames.rendering).toEqual({ iframe: { entry: null }, esm: { exports: ["./Frames"] }, module_federation_2: { exposes: ["./Frames"] } });
      expect(frames.legacy!.issues).toEqual([{ code: "migration.iframe_entry", location: "rendering.iframe", message: "The earlier contract framed index.html and print.html. Choose the document a Portal frames, or leave the entry empty to frame the view's root" }]);
      expect(resolveLegacyIssues(frames, "rendering").legacy!.issues).toEqual([]);
      expect(resolveLegacyIssues(frames, "source").legacy!.issues).toHaveLength(1);

      expect(renderingFromV1({ exports: [{ name: "index.html", modes: ["iframe"] }] }).rendering.iframe).toEqual({ entry: "index.html" });
      expect(renderingFromV1({ exports: [{ name: "./App", modes: ["iframe"] }] }).rendering.iframe).toEqual({ entry: null });
      expect(renderingFromV1({ exports: [{ name: "has space", modes: ["esm"] }] })).toMatchObject({ issues: [{ code: "migration.contract_unreadable" }] });
    });

    it("starts a new Draft from a submitted revision of either format, and never changes a submitted one", () => {
      const before = v1Snapshot(db);
      const access = revisionOf("portal", 1);
      const fromV1 = draftFromSubmitted("portal", access);
      expect(portalDraftSchema.safeParse(fromV1).success).toBe(true);
      expect(fromV1).toMatchObject({ environments: ["prod", "uat"], legacy: { fromRevision: 1 } });
      const v2 = { ownerTeam: "Access Platform", sealId: null, environments: ["prod"], menu: [] };
      expect(draftFromSubmitted("portal", { number: 2, formatVersion: 2, document: v2 })).toBe(v2);
      expect(portalDraftSchema.parse(v2)).toEqual({ ...v2, legacy: null });
      expect(v1Snapshot(db)).toEqual(before);
    });
  });
});
