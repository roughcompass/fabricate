import { beforeEach, describe, expect, it } from "vitest";
import type { RepositorySource } from "@/lib/catalog/source-records";
import type { Db } from "@/lib/db/client";
import { StaleRecordError, TransitionError, ValidationError } from "@/lib/db/errors";
import { compareDocuments } from "@/lib/onboarding/contracts";
import { FALLBACK_ENVIRONMENTS, catalogDigest, catalogFromStudio, environmentCatalog, recordCatalogRead } from "@/lib/onboarding/environments";
import { BlockedError } from "@/lib/onboarding/issues";
import { effectiveMenu } from "@/lib/onboarding/placements";
import {
  activatePortal,
  activationIssues,
  createPortal,
  getPortal,
  governingRevision,
  portalHistory,
  portalRevisionView,
  retirePortal,
  savePortalDraft,
  startPortalDraft,
  submitPortal,
  validatePortalDraft,
} from "@/lib/onboarding/portals";
import { assignDefault } from "@/lib/onboarding/reviews";
import { draftOf, latestSubmitted, revisionByNumber, revisionsOf } from "@/lib/onboarding/revisions";
import { ensurePortal } from "@/lib/ownership/records";
import { buildSource } from "../../support/builders";
import { createTestDb } from "../../support/db";
import { activate, ana, cy, decide, onboardApplication, onboardPortal, placementsOf, portalDraft, portalInput, registerMfe } from "../../support/onboarding";
import { migratedV1Database } from "../../support/onboarding-v1";

const FALLBACK = { source: "fallback" as const, environments: FALLBACK_ENVIRONMENTS, digest: catalogDigest(FALLBACK_ENVIRONMENTS) };

describe("Portal onboarding", () => {
  let db: Db;
  let repository: RepositorySource;

  beforeEach(() => {
    db = createTestDb();
    repository = buildSource(db, { name: "payee" });
  });

  /** An Application launching an external iframe, placed in +portal+ at each route. */
  const placeApplication = (name: string, portal: string, routes: string[], environments = ["uat", "prod"], defaultRequested = false) =>
    onboardApplication(db, name, {
      launch: { kind: "external", mode: "iframe", documentUrl: "https://payments.example.com/app" },
      placements: routes.map((route) => ({ placement: null, portal, menuParent: "payments", route, label: name, order: 1, environments, entitlements: { codes: [], operator: "any" }, defaultRequested })),
    }).application;

  describe("identity and configuration (Portals spec)", () => {
    it("keeps two Portals that share a SEAL ID apart, and a corrected SEAL ID keeps the Portal (Two Portals share a SEAL ID, Portal SEAL ID changes)", () => {
      const access = onboardPortal(db, "Access", { sealId: "88001" });
      const markets = onboardPortal(db, "Markets", { sealId: "88001" });
      expect(access.publicId).not.toBe(markets.publicId);
      expect([access.sealId, markets.sealId]).toEqual(["88001", "88001"]);

      const draft = startPortalDraft(db, access.publicId, ana);
      const saved = savePortalDraft(db, access.publicId, { lockVersion: draft.lockVersion, document: portalDraft({ sealId: "88009" }) });
      submitPortal(db, access.publicId, { lockVersion: saved.lockVersion, actor: ana });
      expect(getPortal(db, access.publicId)).toMatchObject({ publicId: access.publicId, label: "Access", sealId: "88009" });
      expect(getPortal(db, markets.publicId).sealId).toBe("88001");
    });

    it("holds identity, predefined environments, and menus, and no code or platform policy (Portal onboarding completes)", () => {
      const access = onboardPortal(db, "Access");
      const revision = latestSubmitted(db, "portal", access.id)!;
      const view = portalRevisionView(db, access, revision);
      expect(revision.formatVersion).toBe(2);
      expect(revision.document).toEqual({ ownerTeam: "Access Platform", sealId: "88001", environments: ["prod", "uat"], menu: [{ key: "payments", label: "Payments", parent: null, order: 1 }] });
      expect(view.environments.map((environment) => [environment.environment, environment.runtime, environment.enabled, environment.entitlements])).toEqual([
        ["prod", null, true, null],
        ["uat", null, true, null],
      ]);
      expect(view.menu.map((group) => group.key)).toEqual(["payments"]);
      expect(view).toMatchObject({ catalog: { source: "fallback", digest: catalogDigest(FALLBACK_ENVIRONMENTS) }, runtimes: [], contract: null, contractDigest: null });
      const columns = (db.$client.prepare("pragma table_info(portal_revisions)").all() as { name: string }[]).map((column) => column.name);
      expect(columns.filter((name) => /repository|archive|build|cdaas|^version|email/.test(name))).toEqual([]);
    });

    it("identifies its owner by team, with no email field (Portal needs no email)", () => {
      const { portal } = createPortal(db, portalInput("Access", { ownerTeam: "Access Platform" }), ana);
      expect(portal).toMatchObject({ ownerTeam: "Access Platform" });
      for (const table of ["portals", "portal_revisions"]) {
        const columns = (db.$client.prepare(`pragma table_info(${table})`).all() as { name: string }[]).map((column) => column.name);
        expect(columns.filter((name) => /email|owner_(?!team)/.test(name)), table).toEqual([]);
      }
      expect(JSON.stringify(draftOf(db, "portal", portal.id)!.document)).not.toMatch(/ana@example.com/);
    });

    it("onboards a Portal first named in an ownership claim, keeping its identity, and refuses an onboarded name", () => {
      const claimed = ensurePortal(db, "Digital Bank");
      const { portal, adopted } = createPortal(db, portalInput("digital  bank", { ownerTeam: "Digital" }), ana);
      expect(adopted).toBe(true);
      expect(portal.publicId).toBe(claimed.publicId);
      expect(() => createPortal(db, portalInput("Digital Bank", { slug: "digitalbanktwo" }), ana)).toThrow(/already onboarded/);
      expect(() => createPortal(db, portalInput(" ", { sealId: "8 8" }), ana)).toThrow(ValidationError);
    });
  });

  describe("creating (portal-creation spec)", () => {
    const refusal = (input: Parameters<typeof portalInput>[1], name = "Treasury") => {
      try {
        createPortal(db, portalInput(name, input), ana);
      } catch (error) {
        if (error instanceof ValidationError) return error;
        throw error;
      }
      throw new Error("createPortal accepted the input");
    };

    it("records the platform, SEAL ID, description, and the slug its name derives (Portal page shows identity)", () => {
      const { portal } = createPortal(db, portalInput("My New Portal", { platform: "mobile", sealId: "1042", description: "  Treasury for mobile  " }), ana);
      expect(portal).toMatchObject({ label: "My New Portal", platform: "mobile", sealId: "1042", slug: "mynewportal", description: "Treasury for mobile", ownerTeam: null });
    });

    it("keeps an edited slug", () => {
      expect(createPortal(db, portalInput("My New Portal", { slug: "mnp" }), ana).portal.slug).toBe("mnp");
    });

    it.each([
      [{ platform: "" }, "platform", "Choose the Portal's platform"],
      [{ platform: "kiosk" }, "platform", "Choose the Portal's platform"],
      [{ sealId: " " }, "sealId", "Enter the Portal's SEAL ID"],
      [{ sealId: "8 8" }, "sealId", "Enter a SEAL ID of letters, digits, dots, dashes, or underscores"],
      [{ description: "" }, "description", "Enter a description of the Portal"],
      [{ description: "x".repeat(501) }, "description", "Use 500 characters or fewer"],
      [{ slug: "my-portal" }, "slug", "Enter a slug of lowercase letters"],
      [{ slug: "x".repeat(64) }, "slug", "Use 63 letters or fewer"],
    ])("refuses %j at %s", (input, field, message) => {
      expect(refusal(input).messagesFor(field)).toEqual([message]);
      expect(db.$client.prepare("select count(*) as n from portals where label = 'Treasury'").get()).toEqual({ n: 0 });
    });

    it("derives no slug from a name without letters (Name without letters)", () => {
      expect(refusal({}, "2026").messagesFor("slug")).toEqual(["Enter a slug of lowercase letters"]);
    });

    it("refuses a slug another Portal has (Two Portals can't share a slug, Slug taken)", () => {
      onboardPortal(db, "Markets");
      expect(refusal({ slug: "markets" }).messagesFor("slug")).toEqual(["The slug markets belongs to Markets"]);
    });

    it("gives an adopted claim-named Portal the submitted platform, slug, and description", () => {
      const claimed = ensurePortal(db, "Lending");
      const { portal, adopted } = createPortal(db, portalInput("Lending", { platform: "desktop", description: "Loans desk" }), ana);
      expect(adopted).toBe(true);
      expect(portal).toMatchObject({ publicId: claimed.publicId, platform: "desktop", slug: "lending", description: "Loans desk" });
    });
  });

  describe("environments", () => {
    it("selects predefined environments from the fallback catalog, and refuses ones it doesn't list (Portal selects predefined environments)", () => {
      expect(validatePortalDraft(portalDraft({ environments: ["prod", "uat"] }), FALLBACK)).toMatchObject({ issues: [], portal: { environments: ["uat", "prod"], catalog: { source: "fallback" } } });
      const { issues } = validatePortalDraft(portalDraft({ environments: ["uat", "qa", "PROD", "uat"] }), FALLBACK);
      expect(issues.map((issue) => [issue.location, issue.code, issue.message])).toEqual([
        ["environments.1", "portal.environment_unknown", "QA isn't in the fallback environment catalog. Choose one it lists"],
        ["environments.2", "portal.environment_key_invalid", "An environment is chosen from the catalog, such as UAT or PROD"],
        ["environments.3", "portal.environment_duplicate", "UAT is chosen more than once"],
      ]);
      expect(validatePortalDraft(portalDraft({ environments: [] }), FALLBACK).issues.map((issue) => issue.code)).toEqual(["portal.environment_missing"]);
    });

    it("selects from Studio's list when Studio has answered, and records which catalog a revision was checked against (Studio environment catalog is unavailable)", () => {
      const studio = catalogFromStudio([{ id: 4, label: "SIT" }, { id: 7, label: "PROD" }]).environments;
      recordCatalogRead(db, { outcome: "found", environments: studio });
      expect(() => onboardPortal(db, "Access", { environments: ["uat", "prod"] })).toThrow(/UAT isn't in the Studio environment catalog/);
      const access = onboardPortal(db, "Markets", { environments: ["prod", "sit"] });
      const revision = latestSubmitted(db, "portal", access.id)!;
      expect(revision.document.environments).toEqual(["prod", "sit"]);
      expect(portalRevisionView(db, access, revision).catalog).toEqual({ source: "studio", digest: catalogDigest(studio) });

      // Studio drops SIT; the submitted revision keeps the catalog it was checked against.
      recordCatalogRead(db, { outcome: "found", environments: catalogFromStudio([{ id: 7, label: "PROD" }]).environments });
      expect(environmentCatalog(db).digest).not.toBe(catalogDigest(studio));
      expect(portalRevisionView(db, access, latestSubmitted(db, "portal", access.id)!).catalog).toEqual({ source: "studio", digest: catalogDigest(studio) });
    });

    it("refuses runtimes, contracts, and Portal entitlements in a Draft, outside legacy (Portal has no entitlement configuration)", () => {
      const { portal, draft } = createPortal(db, portalInput("Access", { ownerTeam: "Access Platform" }), ana);
      for (const document of [{ ...portalDraft(), runtimes: ["studio-shell"] }, { ...portalDraft(), contract: {} }, { ...portalDraft(), environments: [{ key: "prod", runtime: null, enabled: true, entitlements: { codes: ["ACCESS"], operator: "any" }, inheritFrom: null }] }]) {
        expect(() => savePortalDraft(db, portal.publicId, { lockVersion: draft.lockVersion, document })).toThrow(ValidationError);
      }
      expect(draftOf(db, "portal", portal.id)!.lockVersion).toBe(draft.lockVersion);
    });

    it("never asks for a runtime or contract when it validates a Portal", () => {
      const { issues } = validatePortalDraft(portalDraft({ ownerTeam: null, environments: [] }), FALLBACK);
      expect(issues.map((issue) => issue.code)).toEqual(["portal.owner_missing", "portal.environment_missing"]);
      expect(issues.some((issue) => /runtime|contract|entitlement/i.test(`${issue.code} ${issue.message}`))).toBe(false);
    });
  });

  describe("v1 history", () => {
    it("renders v1 and v2 revisions of one Portal side by side, each with its own frozen rows", () => {
      const v1 = migratedV1Database();
      try {
        const access = getPortal(v1, (v1.$client.prepare("select public_id as id from portals where label = 'Access'").get() as { id: string }).id);
        // Its open v1 Draft is converted: the enabled environments carry over, the rest is history.
        const draft = draftOf(v1, "portal", access.id)!;
        expect(draft.formatVersion).toBe(1);
        const saved = savePortalDraft(v1, access.publicId, { lockVersion: draft.lockVersion, document: { ...portalDraft({ environments: ["uat", "prod"] }), legacy: null } });
        expect(saved.formatVersion).toBe(2);
        expect(submitPortal(v1, access.publicId, { lockVersion: saved.lockVersion, actor: ana })).toMatchObject({ submitted: true, revision: { number: 2, formatVersion: 2 } });

        const [first, second] = revisionsOf(v1, "portal", access.id).map((revision) => portalRevisionView(v1, getPortal(v1, access.publicId), revision));
        expect(first!.revision.formatVersion).toBe(1);
        expect(first!.environments.map((environment) => [environment.environment, environment.runtime, JSON.parse(environment.entitlements!)])).toEqual([
          ["prod", "studio-shell", { codes: ["ACCESS"], operator: "any" }],
          ["uat", "studio-shell", { codes: ["ACCESS_UAT"], operator: "any" }],
        ]);
        expect(first!.runtimes).toEqual(["studio-shell"]);
        expect(first!.contract).toMatchObject({ capabilities: expect.arrayContaining(["navigation"]) });
        expect(first!.catalog).toBeNull();
        expect(second!.environments.map((environment) => [environment.environment, environment.runtime, environment.entitlements])).toEqual([
          ["prod", null, null],
          ["uat", null, null],
        ]);
        expect(second!).toMatchObject({ runtimes: [], contract: null, catalog: { source: "fallback" } });
      } finally {
        v1.$client.close();
      }
    });
  });

  describe("menus and routes", () => {
    it("checks the menu hierarchy: keys, parents, cycles, and depth", () => {
      const menu = [
        { key: "payments", label: "Payments", parent: null, order: 1 },
        { key: "payments", label: "Again", parent: null, order: 2 },
        { key: "a", label: "A", parent: "b", order: 1 },
        { key: "b", label: "B", parent: "a", order: 1 },
        { key: "orphan", label: "Orphan", parent: "missing", order: 1 },
        { key: "Bad Key", label: " ", parent: null, order: 1 },
      ];
      expect(validatePortalDraft(portalDraft({ menu }), FALLBACK).issues.map((issue) => [issue.location, issue.code])).toEqual([
        ["menu.1.key", "portal.menu_duplicate"],
        ["menu.4.parent", "portal.menu_parent_missing"],
        ["menu.5.key", "portal.menu_key_invalid"],
        ["menu.5.label", "portal.menu_label_invalid"],
        ["menu.2.parent", "portal.menu_cycle"],
        ["menu.3.parent", "portal.menu_cycle"],
      ]);
      const deep = ["l1", "l2", "l3", "l4", "l5", "l6"].map((key, index, keys) => ({ key, label: key, parent: index === 0 ? null : keys[index - 1]!, order: 1 }));
      expect(validatePortalDraft(portalDraft({ menu: deep }), FALLBACK).issues.map((issue) => issue.code)).toEqual(["portal.menu_too_deep"]);
    });

    it("builds the effective menu from the governing hierarchy and approved placements, one Application at distinct routes (Application appears more than once)", () => {
      const access = onboardPortal(db, "Access", { menu: [{ key: "payments", label: "Payments", parent: null, order: 1 }, { key: "tools", label: "Tools", parent: "payments", order: 2 }] });
      const app = placeApplication("Payments workspace", access.publicId, ["/payments", "/payments/reports"]);
      const [home, reports] = placementsOf(db, app.publicId);
      decide(db, home!, "approve", { accepted: { menuParent: "payments", defaults: ["prod"] } });
      decide(db, reports!, "approve", { accepted: { menuParent: "tools", label: "Payment reports", order: 3 } });

      const menu = effectiveMenu(db, access.id, governingRevision(db, getPortal(db, access.publicId))!.id, "prod");
      expect(menu.defaultPlacement).toBe(home);
      expect(menu.nodes).toMatchObject([
        {
          kind: "group",
          key: "payments",
          children: [
            { kind: "placement", route: "/payments", label: "Payments workspace", isDefault: true },
            { kind: "group", key: "tools", children: [{ kind: "placement", route: "/payments/reports", label: "Payment reports", isDefault: false, application: app.publicId }] },
          ],
        },
      ]);
    });

    it("keeps two Applications from one active route in a Portal environment (Route collision)", () => {
      const access = onboardPortal(db, "Access");
      const first = placeApplication("Payments workspace", access.publicId, ["/payments"], ["prod"]);
      decide(db, placementsOf(db, first.publicId)[0]!, "approve");
      expect(() => placeApplication("Payments reporting", access.publicId, ["/payments/"], ["prod"])).toThrow(/Access PROD already serves \/payments for Payments workspace/);
      // A different case is a different route; a different environment is a different route table.
      placeApplication("Payments legacy", access.publicId, ["/Payments"], ["prod"]);
      const uat = placeApplication("Payments preview", access.publicId, ["/payments"], ["uat"]);
      decide(db, placementsOf(db, uat.publicId)[0]!, "approve");
    });
  });

  describe("lifecycle", () => {
    it("becomes Ready on a complete revision, and refuses activation until every enabled environment has a default (Portal cannot activate without a default)", () => {
      const { portal, draft } = createPortal(db, portalInput("Access", { ownerTeam: "Access Platform" }), ana);
      expect(submitPortal(db, portal.publicId, { lockVersion: draft.lockVersion, actor: ana })).toMatchObject({ submitted: false });
      expect(getPortal(db, portal.publicId).lifecycle).toBe("draft");
      expect(() => activate(db, portal)).toThrow(/isn't ready/);

      const saved = savePortalDraft(db, portal.publicId, { lockVersion: draft.lockVersion, document: portalDraft() });
      expect(submitPortal(db, portal.publicId, { lockVersion: saved.lockVersion, actor: ana })).toMatchObject({ submitted: true });
      expect(getPortal(db, portal.publicId).lifecycle).toBe("ready");
      let blocked: BlockedError | undefined;
      try {
        activate(db, portal);
      } catch (error) {
        blocked = error as BlockedError;
      }
      expect(blocked).toBeInstanceOf(BlockedError);
      expect(blocked!.issues.map((issue) => [issue.code, issue.location])).toEqual([
        ["portal.default_missing", "environments.prod.default"],
        ["portal.default_missing", "environments.uat.default"],
      ]);

      const app = placeApplication("Payments workspace", portal.publicId, ["/payments"], ["uat", "prod"], true);
      decide(db, placementsOf(db, app.publicId)[0]!, "approve");
      expect(activationIssues(db, getPortal(db, portal.publicId), latestSubmitted(db, "portal", portal.id)!)).toEqual([]);
      expect(activate(db, portal)).toMatchObject({ lifecycle: "active", activeRevisionId: latestSubmitted(db, "portal", portal.id)!.id });
    });

    it("keeps the active revision while a later one waits for activation (Portal configuration changes after activation)", () => {
      const access = onboardPortal(db, "Access");
      const app = placeApplication("Payments workspace", access.publicId, ["/payments"], ["uat", "prod"], true);
      decide(db, placementsOf(db, app.publicId)[0]!, "approve");
      const active = activate(db, access);
      const first = active.activeRevisionId;

      const draft = startPortalDraft(db, access.publicId, ana);
      expect(draft.number).toBe(2);
      const saved = savePortalDraft(db, access.publicId, { lockVersion: draft.lockVersion, document: portalDraft({ ownerTeam: "Access Experience" }) });
      submitPortal(db, access.publicId, { lockVersion: saved.lockVersion, actor: ana });
      expect(getPortal(db, access.publicId)).toMatchObject({ lifecycle: "active", activeRevisionId: first, ownerTeam: "Access Experience" });
      expect(governingRevision(db, getPortal(db, access.publicId))!.number).toBe(1);

      expect(() => activatePortal(db, access.publicId, { revision: 2, lockVersion: 0, actor: cy })).toThrow(StaleRecordError);
      const second = activate(db, access, 2);
      expect(second.activeRevisionId).toBe(revisionByNumber(db, "portal", access.id, 2)!.id);
      expect(() => activate(db, access, 2)).toThrow(/already active/);
    });

    it("refuses a revision that drops a menu group an approved placement uses", () => {
      const access = onboardPortal(db, "Access", { menu: [{ key: "payments", label: "Payments", parent: null, order: 1 }] });
      const app = placeApplication("Payments workspace", access.publicId, ["/payments"], ["uat", "prod"], true);
      decide(db, placementsOf(db, app.publicId)[0]!, "approve");
      activate(db, access);
      const draft = startPortalDraft(db, access.publicId, ana);
      const saved = savePortalDraft(db, access.publicId, { lockVersion: draft.lockVersion, document: portalDraft({ menu: [{ key: "money", label: "Money", parent: null, order: 1 }] }) });
      submitPortal(db, access.publicId, { lockVersion: saved.lockVersion, actor: ana });
      expect(() => activate(db, access, 2)).toThrow(/has no menu group payments, where Payments workspace is placed at \/payments/);
    });

    it("protects a default from retirement until another approved placement takes over (Default placement is retired)", () => {
      const access = onboardPortal(db, "Access");
      const workspace = placeApplication("Payments workspace", access.publicId, ["/payments"], ["uat", "prod"], true);
      const reports = placeApplication("Payments reporting", access.publicId, ["/reports"], ["uat", "prod"]);
      const [home] = placementsOf(db, workspace.publicId);
      const [other] = placementsOf(db, reports.publicId);
      decide(db, home!, "approve");
      decide(db, other!, "approve");
      activate(db, access);

      expect(() => decide(db, home!, "retire")).toThrow(/default in PROD/);
      expect(() => decide(db, home!, "retire", { replacementDefaults: { prod: other!, uat: home! } })).toThrow(/another placement approved in Access UAT/);
      decide(db, home!, "retire", { replacementDefaults: { prod: other!, uat: other! } });
      for (const environment of ["uat", "prod"]) expect(effectiveMenu(db, access.id, getPortal(db, access.publicId).activeRevisionId, environment).defaultPlacement).toBe(other);
      expect(() => assignDefault(db, { portal: access.publicId, environment: "prod", placement: null, expectedSequence: 2, actor: cy })).toThrow(/needs a default route/);
      expect(() => assignDefault(db, { portal: access.publicId, environment: "prod", placement: home!, expectedSequence: 2, actor: cy })).toThrow(/approved in Access PROD/);
    });

    it("retires with a reason once no placement is active, keeping every revision and the history", () => {
      const access = onboardPortal(db, "Access");
      const app = placeApplication("Payments workspace", access.publicId, ["/payments"], ["uat", "prod"], true);
      const [placement] = placementsOf(db, app.publicId);
      decide(db, placement!, "approve");
      const current = () => getPortal(db, access.publicId);
      expect(() => retirePortal(db, access.publicId, { lockVersion: current().lockVersion, reason: " ", actor: cy })).toThrow(/Say why/);
      expect(() => retirePortal(db, access.publicId, { lockVersion: current().lockVersion, reason: "Merged into Markets", actor: cy })).toThrow(/1 approved placement is still active/);
      expect(() => retirePortal(db, access.publicId, { lockVersion: current().lockVersion - 1, reason: "Merged into Markets", actor: cy })).toThrow(StaleRecordError);

      // A Portal that isn't Active yet can lose its default.
      decide(db, placement!, "withdraw", { actor: ana });
      expect(effectiveMenu(db, access.id, governingRevision(db, current())!.id, "prod")).toMatchObject({ defaultPlacement: null, nodes: [{ kind: "group", children: [] }] });
      const retired = retirePortal(db, access.publicId, { lockVersion: current().lockVersion, reason: "Merged into Markets", actor: cy });
      expect(retired.lifecycle).toBe("retired");
      expect(latestSubmitted(db, "portal", access.id)?.number).toBe(1);
      expect(portalHistory(db, access.id)[0]).toMatchObject({ event: "retired", reason: "Merged into Markets", fromLifecycle: "ready", toLifecycle: "retired", actor: "cy@example.com" });
      expect(() => decide(db, placement!, "approve")).toThrow(/A withdrawn placement can't be approved/);
    });

    it("records each lifecycle change and submission with its actor, labeled Unverified (lifecycle history)", () => {
      const access = onboardPortal(db, "Access");
      const app = placeApplication("Payments workspace", access.publicId, ["/payments"], ["uat", "prod"], true);
      decide(db, placementsOf(db, app.publicId)[0]!, "approve");
      activate(db, access);
      expect(portalHistory(db, access.id).map((event) => [event.event, event.revision, event.fromLifecycle, event.toLifecycle, event.actor, event.attribution]).reverse()).toEqual([
        ["created", null, null, "draft", "ana@example.com", "unverified"],
        ["draft_started", 1, null, null, "ana@example.com", "unverified"],
        ["submitted", 1, null, null, "ana@example.com", "unverified"],
        ["ready", 1, "draft", "ready", "ana@example.com", "unverified"],
        ["activated", 1, "ready", "active", "cy@example.com", "unverified"],
      ]);
      expect(draftOf(db, "portal", access.id)).toBeUndefined();
      expect(() => startPortalDraft(db, "ptl_aaaaaaaaaaaaaaaa", ana)).toThrow(/doesn't exist/);
    });

    it("refuses changes to a retired Portal", () => {
      const access = onboardPortal(db, "Access");
      retirePortal(db, access.publicId, { lockVersion: getPortal(db, access.publicId).lockVersion, reason: "Never launched", actor: cy });
      expect(() => startPortalDraft(db, access.publicId, ana)).toThrow(TransitionError);
      expect(() => retirePortal(db, access.publicId, { lockVersion: getPortal(db, access.publicId).lockVersion, reason: "Again", actor: cy })).toThrow(/already retired/);
    });
  });

  it("compares revisions readably, by set member and keyed item", () => {
    const before = { ownerTeam: "Access Platform", sealId: "88001", environments: ["prod", "uat"], menu: [{ key: "payments", label: "Payments", parent: null, order: 1 }] };
    const after = { ...before, environments: ["dev", "prod"], menu: [{ key: "payments", label: "Payments and transfers", parent: null, order: 1 }] };
    expect(compareDocuments(before, after)).toEqual([
      { path: "environments", change: "added", before: null, after: "dev" },
      { path: "environments", change: "removed", before: "uat", after: null },
      { path: "menu.payments.label", change: "changed", before: "Payments", after: "Payments and transfers" },
    ]);
    expect(compareDocuments(before, before)).toEqual([]);
  });

  it("uses MFEs and Repositories only through Applications, never as Portal configuration", () => {
    registerMfe(db, "Payee search", { repository });
    const access = onboardPortal(db, "Access");
    expect(db.$client.prepare("select count(*) as n from portal_revisions where portal_id = ?").get(access.id)).toEqual({ n: 1 });
  });
});
