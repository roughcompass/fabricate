import { beforeEach, describe, expect, it } from "vitest";
import type { RepositorySource } from "@/lib/catalog/source-records";
import type { Db } from "@/lib/db/client";
import {
  applicationHistory,
  applicationReadiness,
  applicationRevisionView,
  confirmRendering,
  createWebApplication,
  getApplication,
  inferRendering,
  launchDigest,
  modeOfStudioTypes,
  placementStatesOf,
  readApplicationDraft,
  retireWebApplication,
  saveApplicationDraft,
  silentEvidence,
  startApplicationDraft,
  submitApplication,
} from "@/lib/onboarding/applications";
import { getMicrofrontend } from "@/lib/onboarding/microfrontends";
import { ValidationError } from "@/lib/db/errors";
import { catalogDigest, FALLBACK_ENVIRONMENTS } from "@/lib/onboarding/environments";
import { draftOf, latestSubmitted, revisionsOf } from "@/lib/onboarding/revisions";
import { buildSource } from "../../support/builders";
import { createTestDb, rawRun } from "../../support/db";
import {
  type ApplicationSpec,
  CHILD_RENDERING,
  ana,
  applicationDraft,
  cdaasView,
  cy,
  decide,
  observeCdaas,
  observeStudio,
  onboardApplication,
  onboardPortal,
  placementsOf,
  registerMfe,
} from "../../support/onboarding";
import { migratedV1Database } from "../../support/onboarding-v1";

const placement = (portal: string, route: string, overrides: Record<string, unknown> = {}) => ({ placement: null, portal, menuParent: "payments", route, label: "Payments", order: 1, environments: ["uat", "prod"], entitlements: { codes: [], operator: "any" as const }, defaultRequested: false, ...overrides });

describe("Web Applications", () => {
  let db: Db;
  let repository: RepositorySource;
  let access: string;
  let markets: string;

  beforeEach(() => {
    db = createTestDb();
    repository = buildSource(db, { name: "payee" });
    access = onboardPortal(db, "Access").publicId;
    markets = onboardPortal(db, "Markets", { sealId: "88002" }).publicId;
  });

  /** Saves +spec+ into a new Application's Draft and submits it, returning what validation found. */
  const attempt = (spec: ApplicationSpec, confirm = true) => {
    const { application, draft } = createWebApplication(db, { name: "Payments workspace", ownerTeam: "Payments" }, ana);
    let revision = saveApplicationDraft(db, application.publicId, { lockVersion: draft.lockVersion, document: applicationDraft({ name: "Payments workspace", ...spec }) });
    if (confirm && revision.document.launch && (revision.document.launch as { mode: unknown }).mode) revision = confirmRendering(db, application.publicId, { lockVersion: revision.lockVersion, candidate: null, actor: ana });
    return { application, result: submitApplication(db, application.publicId, { lockVersion: revision.lockVersion, actor: ana }) };
  };
  const issues = (spec: ApplicationSpec, confirm = true) => attempt(spec, confirm).result.issues.filter((issue) => issue.severity === "blocking").map((issue) => [issue.code, issue.location]);
  const external = (launch: Record<string, unknown>) => ({ launch: { kind: "external" as const, ...launch } });

  describe("identity", () => {
    it("keeps Applications that share a SEAL ID apart: owners, compositions, placements, and histories (Applications share one SEAL ID)", () => {
      const search = registerMfe(db, "Payee search", { repository });
      const first = onboardApplication(db, "Payments workspace", { sealId: "88001", ownerTeam: "Payments", launch: { kind: "mfe", microfrontend: search.publicId, mode: "module_federation_2", exposedModule: "./App" }, placements: [placement(access, "/payments")] }).application;
      const second = onboardApplication(db, "Payments reporting", { sealId: "88001", ownerTeam: "Payments Insights", ...external({ mode: "iframe", documentUrl: "https://payments.example.com/reports" }), placements: [placement(markets, "/reports")] }).application;

      expect([first.sealId, second.sealId]).toEqual(["88001", "88001"]);
      expect([first.ownerTeam, second.ownerTeam]).toEqual(["Payments", "Payments Insights"]);
      expect(applicationRevisionView(db, first.activeRevisionId!).components.map((row) => row.microfrontend.name)).toEqual(["Payee search"]);
      expect(applicationRevisionView(db, second.activeRevisionId!).components).toEqual([]);
      expect(placementStatesOf(db, first.id).map((state) => state.portalName)).toEqual(["Access"]);
      expect(placementStatesOf(db, second.id).map((state) => state.portalName)).toEqual(["Markets"]);
      expect(applicationHistory(db, first.id).every((event) => event.applicationId === first.id)).toBe(true);
    });
  });

  describe("launch targets", () => {
    it("accepts a single-MFE Application with no separate shell (Single-MFE Application)", () => {
      const search = registerMfe(db, "Payee search", { repository, rendering: { iframe: null, esm: { exports: ["./App"] }, module_federation_2: null } });
      const { application } = onboardApplication(db, "Payee search", { launch: { kind: "mfe", microfrontend: search.publicId, mode: "esm", exportedModule: "./App" } });
      const view = applicationRevisionView(db, application.activeRevisionId!);
      expect(view.target?.target).toMatchObject({ kind: "mfe", renderingMode: "esm", exportedModule: "./App", documentUrl: null, moduleUrl: null });
      expect(view.components.map((row) => [row.microfrontend.name, row.component.role])).toEqual([["Payee search", "entry"]]);
      expect(db.$client.prepare("select count(*) as n from microfrontends").get()).toEqual({ n: 1 });
    });

    it("treats an MF2 entry MFE as the host of three children, validating all four as one composition (Composite Application)", () => {
      const host = registerMfe(db, "Payee hub", { repository });
      const children = ["Search", "Details", "History"].map((name) => registerMfe(db, `Payee ${name}`, { repository: buildSource(db, { name: `payee-${name.toLowerCase()}` }), rendering: CHILD_RENDERING }));
      const { application } = onboardApplication(db, "Payee hub", {
        launch: { kind: "mfe", microfrontend: host.publicId, mode: "module_federation_2", exposedModule: "./App" },
        children: children.map((child, index) => ({ microfrontend: child.publicId, mountKind: "slot" as const, mountKey: ["search", "details", "history"][index]!, required: index < 2, module: null })),
      });
      expect(applicationRevisionView(db, application.activeRevisionId!).components.map((row) => [row.microfrontend.name, row.component.role, row.component.mountKey, row.component.module, row.component.hostConfiguration])).toEqual([
        ["Payee hub", "entry", null, null, "{}"],
        ["Payee Details", "child", "details", "./Widget", "{}"],
        ["Payee History", "child", "history", "./Widget", "{}"],
        ["Payee Search", "child", "search", "./Widget", "{}"],
      ]);
    });

    it.each([
      ["iframe", { mode: "iframe", documentUrl: "https://payments.example.com/app", sandbox: ["allow-scripts"] }],
      ["ESM", { mode: "esm", moduleUrl: "https://cdn.example.com/payments/app.js", exportedModule: "mount" }],
      ["Module Federation 2", { mode: "module_federation_2", manifestUrl: "https://cdn.example.com/payments/mf-manifest.json", exposedModule: "./App" }],
    ])("launches an external %s endpoint without registering an MFE or a CDaaS view (Externally hosted iframe Application, Externally hosted Module Federation Application)", (_label, launch) => {
      const { application } = onboardApplication(db, "Payments workspace", external(launch), {});
      const view = applicationRevisionView(db, application.activeRevisionId!);
      expect(view.target?.target).toMatchObject({ kind: "external", microfrontendId: null, confirmation: "explicit" });
      expect(view.components).toEqual([]);
      expect(db.$client.prepare("select count(*) as n from microfrontends").get()).toEqual({ n: 0 });
    });

    it("refuses no source, both sources, missing mode values, and unsafe endpoints, at their fields (Both target kinds supplied, External endpoint configuration is incomplete)", () => {
      const search = registerMfe(db, "Payee search", { repository });
      expect(issues({ launch: {} }, false)).toEqual([["launch.missing", "launch.kind"]]);
      expect(issues({ launch: { kind: "external", microfrontend: search.publicId, mode: "iframe", documentUrl: "https://payments.example.com/app" } })).toEqual([["launch.both_sources", "launch"]]);
      expect(issues({ launch: { kind: "mfe", microfrontend: search.publicId, mode: "module_federation_2", exposedModule: "./App", manifestUrl: "https://cdn.example.com/mf.json" } })).toEqual([["launch.both_sources", "launch"]]);
      expect(issues(external({ mode: "module_federation_2" }))).toEqual([
        ["launch.value_missing", "launch.exposedModule"],
        ["launch.value_missing", "launch.manifestUrl"],
      ]);
      expect(issues(external({ mode: "iframe", documentUrl: "https://ci:secret@payments.example.com/app" }))).toEqual([["launch.endpoint_unsafe", "launch.documentUrl"]]);
      expect(issues(external({ mode: "iframe", documentUrl: "https://payments.example.com/app#main" }))).toEqual([["launch.endpoint_unsafe", "launch.documentUrl"]]);
      expect(issues(external({ mode: "iframe", documentUrl: "http://payments.example.com/app" }))).toEqual([["launch.endpoint_unsafe", "launch.documentUrl"]]);
      expect(issues(external({ mode: "esm", moduleUrl: "javascript:alert(1)", exportedModule: "mount" }))).toEqual([["launch.endpoint_unsafe", "launch.moduleUrl"]]);
      expect(issues({ launch: { kind: "mfe", microfrontend: search.publicId, mode: "esm", exportedModule: "./App" } })).toEqual([["launch.mode_not_supported", "launch.mode"]]);
      expect(issues({ launch: { kind: "mfe", microfrontend: search.publicId, mode: "module_federation_2", exposedModule: "./Other" } })).toEqual([["launch.module_not_exported", "launch.exposedModule"]]);
    });

    it("refuses at the database a launch target with no source, both sources, or missing mode fields", () => {
      const { application } = createWebApplication(db, { name: "Raw", ownerTeam: "Payments" }, ana);
      const draft = draftOf(db, "application", application.id)!;
      const insert = (columns: string, values: string) => () => rawRun(db, `insert into application_launch_targets (application_revision_id, ${columns}, confirmation, confirmed_by, confirmed_at) values (?, ${values}, 'explicit', 'ana', 1)`, draft.id);
      expect(insert("kind, rendering_mode", "'mfe', 'iframe'")).toThrow(/application_launch_targets_source/);
      expect(insert("kind, rendering_mode, microfrontend_id, document_url", "'external', 'iframe', NULL, NULL")).toThrow(/application_launch_targets_source/);
      expect(insert("kind, rendering_mode, module_url", "'external', 'esm', 'https://cdn.example.com/app.js'")).toThrow(/application_launch_targets_source/);
      expect(insert("kind, rendering_mode, document_url", "'external', 'iframe', 'https://a:b@payments.example.com/'")).toThrow(/application_launch_targets_urls/);
      expect(insert("kind, rendering_mode, document_url", "'external', 'iframe', 'ftp://payments.example.com/'")).toThrow(/application_launch_targets_urls/);
    });
  });

  describe("rendering-mode inference", () => {
    it("proposes nothing from unknown evidence, or for an external endpoint", () => {
      const search = registerMfe(db, "Payee search", { repository });
      observeStudio(db, { kind: "microfrontend", id: search.id }, "module", "6f1d", { outcome: "unavailable", error: "Studio didn't answer in time" });
      expect(inferRendering(db, applicationDraft({ launch: { kind: "mfe", microfrontend: search.publicId } }).launch).candidates.map((candidate) => candidate.source)).toEqual(["mfe_contract"]);
      expect(silentEvidence(db, { kind: "mfe", microfrontend: search.publicId })).toEqual(["Studio module 6f1d proposes nothing: Studio hasn't answered a read of it yet"]);
      observeStudio(db, { kind: "microfrontend", id: search.id }, "module", "6f1d", { outcome: "found", projection: { uuid: "6f1d", title: "Payee search", appId: null, url: null, sealId: null, status: null, version: null, typeLabels: ["MFE"] } });
      expect(inferRendering(db, applicationDraft({ launch: { kind: "mfe", microfrontend: search.publicId } }).launch).candidates.map((candidate) => candidate.source)).toEqual(["mfe_contract"]);
      expect(silentEvidence(db, { kind: "mfe", microfrontend: search.publicId })).toEqual(["Studio module 6f1d proposes nothing: its type doesn't name a rendering mode"]);
      expect(inferRendering(db, applicationDraft({ launch: { kind: "external", mode: "iframe", documentUrl: "https://payments.example.com/app" } }).launch)).toEqual({ candidates: [], agreed: false });
      expect(inferRendering(db, applicationDraft({ launch: { kind: "mfe", microfrontend: "mfe_aaaaaaaaaaaaaaaa" } }).launch).candidates).toEqual([]);
    });

    it("proposes one mode from agreeing evidence, and waits for the team to confirm or override it (One supported mode is observed)", () => {
      const search = registerMfe(db, "Payee search", { repository });
      observeStudio(db, { kind: "microfrontend", id: search.id }, "module", "6f1d", { outcome: "found", projection: { uuid: "6f1d", title: "Payee search", appId: "payee", url: "https://cdn.example.com/payee/mf-manifest.json", sealId: "88001", status: "Active", version: 3, typeLabels: ["Module Federation"] } });
      const launch = applicationDraft({ launch: { kind: "mfe", microfrontend: search.publicId } }).launch;
      const inference = inferRendering(db, launch);
      expect(inference.agreed).toBe(true);
      expect(inference.candidates.map((candidate) => [candidate.source, candidate.mode, candidate.module, candidate.evidence])).toEqual([
        ["mfe_contract", "module_federation_2", "./App", "Payee search revision 1 rendering metadata"],
        ["studio", "module_federation_2", null, "Studio module 6f1d"],
      ]);

      const { application, draft } = createWebApplication(db, { name: "Payments workspace", ownerTeam: "Payments" }, ana);
      const saved = saveApplicationDraft(db, application.publicId, { lockVersion: draft.lockVersion, document: applicationDraft({ name: "Payments workspace", launch: { kind: "mfe", microfrontend: search.publicId } }) });
      expect(submitApplication(db, application.publicId, { lockVersion: saved.lockVersion, actor: ana }).issues.map((issue) => issue.code)).toEqual(["launch.mode_missing"]);

      const confirmed = confirmRendering(db, application.publicId, { lockVersion: saved.lockVersion, candidate: inference.candidates[0]!.key, actor: cy });
      expect(readApplicationDraft(confirmed)).toMatchObject({ launch: { mode: "module_federation_2", exposedModule: "./App" }, confirmation: { kind: "inferred", candidate: inference.candidates[0]!.key, by: "cy@example.com" } });
      const result = submitApplication(db, application.publicId, { lockVersion: confirmed.lockVersion, actor: ana });
      expect(result.submitted).toBe(true);
      const view = applicationRevisionView(db, result.revision.id);
      expect(view.target?.target).toMatchObject({ confirmation: "inferred", confirmedBy: "cy@example.com", renderingMode: "module_federation_2" });
      expect(view.candidates.map((candidate) => [candidate.source, candidate.renderingMode, candidate.chosen])).toEqual([
        ["mfe_contract", "module_federation_2", true],
        ["studio", "module_federation_2", false],
      ]);
    });

    it("shows every candidate when the evidence conflicts, requires a choice, and keeps the inference beside an override (Rendering evidence conflicts)", () => {
      const search = registerMfe(db, "Payee search", { repository, rendering: { iframe: null, esm: { exports: ["./App"] }, module_federation_2: { exposes: ["./App"] } } });
      const launch = applicationDraft({ launch: { kind: "mfe", microfrontend: search.publicId } }).launch;
      const inference = inferRendering(db, launch);
      expect(inference).toMatchObject({ agreed: false, candidates: [{ mode: "esm" }, { mode: "module_federation_2" }] });

      const { application, draft } = createWebApplication(db, { name: "Payments workspace", ownerTeam: "Payments" }, ana);
      let revision = saveApplicationDraft(db, application.publicId, { lockVersion: draft.lockVersion, document: applicationDraft({ name: "Payments workspace", launch: { kind: "mfe", microfrontend: search.publicId, mode: "esm", exportedModule: "./App" } }) });
      expect(submitApplication(db, application.publicId, { lockVersion: revision.lockVersion, actor: ana }).issues.find((issue) => issue.code === "launch.unconfirmed")?.message).toBe("The evidence proposes different rendering modes. Choose one, or override them");
      revision = confirmRendering(db, application.publicId, { lockVersion: revision.lockVersion, candidate: null, actor: ana });
      expect(readApplicationDraft(revision).confirmation?.kind).toBe("override");

      // Changing the launch values clears the confirmation.
      const changed = { ...readApplicationDraft(revision), launch: { ...readApplicationDraft(revision).launch, mode: "module_federation_2" as const, exposedModule: "./App" } };
      expect(changed.confirmation!.launchDigest).not.toBe(launchDigest(changed.launch));
      revision = saveApplicationDraft(db, application.publicId, { lockVersion: revision.lockVersion, document: changed });
      expect(readApplicationDraft(revision).confirmation).toBeNull();
      revision = confirmRendering(db, application.publicId, { lockVersion: revision.lockVersion, candidate: null, actor: ana });
      const result = submitApplication(db, application.publicId, { lockVersion: revision.lockVersion, actor: ana });
      expect(applicationRevisionView(db, result.revision.id).candidates.map((candidate) => [candidate.renderingMode, candidate.chosen])).toEqual([
        ["esm", false],
        ["module_federation_2", false],
      ]);
      expect(applicationRevisionView(db, result.revision.id).target?.target.confirmation).toBe("override");
      expect(() => confirmRendering(db, application.publicId, { lockVersion: 0, candidate: "missing", actor: ana })).toThrow();
    });

    it("reads a mode only from Studio types that name one", () => {
      expect([modeOfStudioTypes(["Module Federation"]), modeOfStudioTypes(["ESM"]), modeOfStudioTypes(["IFrame"]), modeOfStudioTypes(["MFE"]), modeOfStudioTypes(["ESM", "iframe"])]).toEqual(["module_federation_2", "esm", "iframe", null, null]);
    });
  });

  describe("composition", () => {
    it("lets an external host compose children, with no entry binding (External host composes children, External Application has child-only bindings)", () => {
      const children = ["Search", "Details"].map((name) => registerMfe(db, `Payee ${name}`, { repository: buildSource(db, { name: `payee-${name.toLowerCase()}` }), rendering: CHILD_RENDERING }));
      const { application } = onboardApplication(db, "Payments console", {
        launch: { kind: "external", mode: "esm", moduleUrl: "https://cdn.example.com/console.js", exportedModule: "mount" },
        children: children.map((child, index) => ({ microfrontend: child.publicId, mountKind: "route" as const, mountKey: `/${child.name.split(" ")[1]!.toLowerCase()}${index ? "/" : ""}`, required: true, module: null })),
      });
      expect(applicationRevisionView(db, application.activeRevisionId!).components.map((row) => [row.component.role, row.component.mountKind, row.component.mountKey])).toEqual([
        ["child", "route", "/details"],
        ["child", "route", "/search"],
      ]);
    });

    it("settles the module a host mounts from each child's rendering metadata, and asks when a child offers several", () => {
      const host = registerMfe(db, "Payee hub", { repository });
      const child = registerMfe(db, "Payee search", { repository: buildSource(db, { name: "search" }), rendering: { iframe: null, esm: { exports: ["./Search", "./Results"] }, module_federation_2: { exposes: ["./Search"] } } });
      const framed = registerMfe(db, "Payee print", { repository: buildSource(db, { name: "print" }), rendering: { iframe: { entry: "print.html" }, esm: null, module_federation_2: null } });
      const launch = { kind: "mfe" as const, microfrontend: host.publicId, mode: "module_federation_2" as const, exposedModule: "./App" };
      const bind = (microfrontend: string, mountKey: string, module: string | null) => ({ microfrontend, mountKind: "slot" as const, mountKey, required: true, module });
      expect(attempt({ launch, children: [bind(child.publicId, "search", null), bind(framed.publicId, "print", "./Print")] }).result.issues.map((issue) => [issue.code, issue.location, issue.message])).toEqual([
        ["composition.module_missing", "children.0.module", "Choose which of Payee search's modules the host mounts: ./Results, ./Search"],
        ["composition.module_unknown", "children.1.module", "Payee print names no module to mount; it can only be framed"],
      ]);
      expect(issues({ launch, children: [bind(child.publicId, "search", "./Other")] })).toEqual([["composition.module_unknown", "children.0.module"]]);
      const { application } = onboardApplication(db, "Payee hub", { launch, children: [bind(child.publicId, "search", "./Results"), bind(framed.publicId, "print", null)] });
      expect(applicationRevisionView(db, application.activeRevisionId!).components.map((row) => [row.microfrontend.name, row.component.module])).toEqual([
        ["Payee hub", null],
        ["Payee print", null],
        ["Payee search", "./Results"],
      ]);
    });

    it("refuses a child that's the entry, and a duplicate binding or mount, and lets an external host compose children with no contract", () => {
      const host = registerMfe(db, "Payee hub", { repository });
      const child = registerMfe(db, "Payee search", { repository: buildSource(db, { name: "search" }), rendering: CHILD_RENDERING });
      const bind = (microfrontend: string, mountKey: string, mountKind: "route" | "slot" | null = "slot") => ({ microfrontend, mountKind, mountKey, required: true, module: null });
      expect(issues({ launch: { kind: "mfe", microfrontend: host.publicId, mode: "module_federation_2", exposedModule: "./App" }, children: [bind(host.publicId, "self"), bind(child.publicId, "a"), bind(child.publicId, "a"), bind(child.publicId, "", null)] })).toEqual([
        ["composition.child_is_entry", "children.0.microfrontend"],
        ["composition.duplicate", "children.2.microfrontend"],
        ["composition.mount_duplicate", "children.2.mountKey"],
        ["composition.duplicate", "children.3.microfrontend"],
        ["composition.mount_missing", "children.3.mountKind"],
      ]);
      expect(issues({ ...external({ mode: "esm", moduleUrl: "https://cdn.example.com/console.js", exportedModule: "mount" }), children: [bind(child.publicId, "search")] })).toEqual([]);
    });
  });

  describe("placements", () => {
    it("places one Application in several Portals, and at several distinct routes of one Portal (Application appears in two Portals)", () => {
      const { application } = onboardApplication(db, "Payments workspace", { ...external({ mode: "iframe", documentUrl: "https://payments.example.com/app" }), placements: [placement(access, "/payments"), placement(access, "/payments/reports", { label: "Reports" }), placement(markets, "/payments", { entitlements: { codes: ["MARKETS"], operator: "any" } })] });
      const [home, reports, marketsHome] = placementsOf(db, application.publicId);
      decide(db, home!, "approve");
      decide(db, reports!, "approve");
      decide(db, marketsHome!, "approve");
      expect(placementStatesOf(db, application.id).map((state) => [state.portalName, state.effective])).toEqual([
        ["Access", "approved"],
        ["Access", "approved"],
        ["Markets", "approved"],
      ]);
      expect(new Set([home, reports, marketsHome]).size).toBe(3);
    });

    it("keeps one Portal's rejection from touching another Portal's approval (One placement is rejected)", () => {
      const { application } = onboardApplication(db, "Payments workspace", { ...external({ mode: "iframe", documentUrl: "https://payments.example.com/app" }), placements: [placement(access, "/payments"), placement(markets, "/payments")] });
      const [inAccess, inMarkets] = placementsOf(db, application.publicId);
      decide(db, inAccess!, "approve");
      decide(db, inMarkets!, "reject", { reason: "Markets has its own payments workspace" });
      expect(placementStatesOf(db, application.id).map((state) => [state.portalName, state.latest])).toEqual([
        ["Access", "approved"],
        ["Markets", "rejected"],
      ]);
      expect(applicationReadiness(db, getApplication(db, application.publicId)).ready).toBe(true);
    });

    it("leaves every request pending until its Portal's review, and checks each against its Portal (Application team submits a placement)", () => {
      const { application } = onboardApplication(db, "Payments workspace", { ...external({ mode: "iframe", documentUrl: "https://payments.example.com/app" }), placements: [placement(access, "/payments")] });
      expect(placementStatesOf(db, application.id)).toMatchObject([{ latest: "pending", effective: "pending" }]);
      expect(db.$client.prepare("select count(*) as n from placement_routes").get()).toEqual({ n: 0 });
      expect(issues({ ...external({ mode: "iframe", documentUrl: "https://payments.example.com/app" }), placements: [placement(access, "payments", { environments: ["prod", "dr"], menuParent: "missing", label: " " })] })).toEqual([
        ["placement.environment_unavailable", "placements.0.environments"],
        ["placement.label_invalid", "placements.0.label"],
        ["placement.menu_parent_unknown", "placements.0.menuParent"],
        ["placement.route_invalid", "placements.0.route"],
      ]);
    });

    it("chooses each placement's environments from its Portal's, failing only the placement that asks for another (Placement selects unavailable environment, Production differs from UAT)", () => {
      const uatOnly = onboardPortal(db, "Treasury", { environments: ["uat"] }).publicId;
      const found = attempt({ ...external({ mode: "iframe", documentUrl: "https://payments.example.com/app" }), placements: [placement(access, "/payments", { environments: ["uat", "test"] }), placement(markets, "/payments"), placement(uatOnly, "/payments", { environments: ["uat", "prod"] })] }).result.issues;
      expect(found.map((issue) => [issue.code, issue.location, issue.message])).toEqual([
        ["placement.environment_unavailable", "placements.0.environments", "TEST is unavailable for this placement: Access doesn't enable it"],
        ["placement.environment_unavailable", "placements.2.environments", "PROD is unavailable for this placement: Treasury doesn't enable it"],
      ]);
      const { application } = onboardApplication(db, "Payments workspace", { ...external({ mode: "iframe", documentUrl: "https://payments.example.com/app" }), placements: [placement(uatOnly, "/payments", { environments: ["uat"], menuParent: "payments" })] });
      expect(applicationRevisionView(db, application.activeRevisionId!).requests.map((row) => row.environments)).toEqual([["uat"]]);
    });

    it("requests entitlements on the placement, never on the Portal or the Application (Placement carries entitlements)", () => {
      const { application } = onboardApplication(db, "Payments approvals", { ...external({ mode: "iframe", documentUrl: "https://payments.example.com/approvals" }), placements: [placement(access, "/approvals", { environments: ["prod"], entitlements: { codes: ["PAYMENTS_APPROVER"], operator: "any" } })] });
      const [request] = applicationRevisionView(db, application.activeRevisionId!).requests;
      expect(JSON.parse(request!.request.entitlements)).toEqual({ codes: ["PAYMENTS_APPROVER"], operator: "any" });
      const revision = latestSubmitted(db, "application", application.id)!;
      expect(Object.keys(revision.document).sort()).toEqual(["children", "confirmation", "launch", "name", "ownerTeam", "placements", "sealId"]);
      expect(db.$client.prepare("select count(*) as n from portal_environments where entitlements is not null").get()).toEqual({ n: 0 });
      for (const table of ["applications", "application_revisions"]) {
        const columns = (db.$client.prepare(`pragma table_info(${table})`).all() as { name: string }[]).map((column) => column.name);
        expect(columns.filter((name) => /entitlement|email/.test(name)), table).toEqual([]);
      }
    });
  });

  describe("submission", () => {
    it("reports every blocking issue together, with stable codes and locations, and submits nothing (Several onboarding issues)", () => {
      const disabled = buildSource(db, { name: "legacy" });
      const child = registerMfe(db, "Legacy widget", { repository: disabled, rendering: CHILD_RENDERING });
      rawRun(db, "update repository_sources set enabled = 0 where id = ?", disabled.id);
      const occupant = onboardApplication(db, "Payments reporting", { ...external({ mode: "iframe", documentUrl: "https://payments.example.com/reports" }), placements: [placement(access, "/payments", { environments: ["prod"] })] }).application;
      decide(db, placementsOf(db, occupant.publicId)[0]!, "approve");

      const { application, result } = attempt({ launch: {}, children: [{ microfrontend: child.publicId, mountKind: "slot", mountKey: "widget", required: true, module: null }], placements: [placement(access, "/payments", { environments: ["prod"] })] }, false);
      expect(result.submitted).toBe(false);
      expect(result.issues.map((issue) => [issue.code, issue.location])).toEqual([
        ["mfe.source_unavailable", "children.0"],
        ["launch.missing", "launch.kind"],
        ["placement.route_collision", "placements.0.route"],
      ]);
      expect(revisionsOf(db, "application", application.id).map((revision) => revision.state)).toEqual(["draft"]);
      expect(db.$client.prepare("select count(*) as n from application_launch_targets lt join application_revisions r on r.id = lt.application_revision_id where r.application_id = ?").get(application.id)).toEqual({ n: 0 });
      expect(db.$client.prepare("select count(*) as n from application_placements where application_id = ?").get(application.id)).toEqual({ n: 0 });
    });

    it("names each placement in the frozen revision, so the next Draft revises it instead of requesting another", () => {
      const { application } = onboardApplication(db, "Payments workspace", { ...external({ mode: "iframe", documentUrl: "https://payments.example.com/app" }), placements: [placement(access, "/payments"), placement(markets, "/payments")] });
      const [first, second] = placementsOf(db, application.publicId);
      decide(db, first!, "approve");
      const draft = startApplicationDraft(db, application.publicId, ana);
      const document = readApplicationDraft(draft);
      expect(document.placements.map((item) => item.placement)).toEqual(expect.arrayContaining([first, second]));
      document.placements = document.placements.map((item) => (item.placement === second ? { ...item, route: "/markets/payments" } : item));
      const saved = saveApplicationDraft(db, application.publicId, { lockVersion: draft.lockVersion, document });
      const result = submitApplication(db, application.publicId, { lockVersion: saved.lockVersion, actor: ana });
      expect(result.issues.filter((issue) => issue.severity === "blocking")).toEqual([]);
      // The same two placements, revised; the canonical document orders them by Portal and route.
      expect([...placementsOf(db, application.publicId)].sort()).toEqual([first, second].sort());
      expect(placementStatesOf(db, application.id).map((state) => [state.placement, state.latest, state.effective, state.revision])).toEqual(
        expect.arrayContaining([
          [first, "pending", "approved", 2],
          [second, "pending", "pending", 2],
        ]),
      );
    });

    it("freezes a submitted revision; later edits start a new Draft (Composition changes during review)", () => {
      const host = registerMfe(db, "Payee hub", { repository });
      const child = registerMfe(db, "Payee search", { repository: buildSource(db, { name: "search" }), rendering: CHILD_RENDERING });
      const { application } = onboardApplication(db, "Payee hub", { launch: { kind: "mfe", microfrontend: host.publicId, mode: "module_federation_2", exposedModule: "./App" }, placements: [placement(access, "/payee")] });
      const second = startApplicationDraft(db, application.publicId, ana);
      const document = readApplicationDraft(second);
      document.children.push({ microfrontend: child.publicId, mountKind: "slot", mountKey: "search", required: true, module: null });
      saveApplicationDraft(db, application.publicId, { lockVersion: second.lockVersion, document });

      expect(applicationRevisionView(db, application.activeRevisionId!).components.map((row) => row.microfrontend.name)).toEqual(["Payee hub"]);
      expect(() => rawRun(db, "insert into application_components (application_revision_id, microfrontend_id, role, mount_kind, mount_key, required) values (?, ?, 'child', 'slot', 'late', 1)", application.activeRevisionId, child.id)).toThrow(/frozen with it/);
      expect(placementStatesOf(db, application.id)).toMatchObject([{ latest: "pending", revision: 1 }]);
      expect(revisionsOf(db, "application", application.id).map((revision) => [revision.number, revision.state])).toEqual([
        [1, "submitted"],
        [2, "draft"],
      ]);
    });
  });

  describe("readiness", () => {
    it("is Ready only with a confirmed target, confirmed MFEs, and an approved placement, and not while CDaaS can't confirm the entry (CDaaS view cannot be confirmed)", () => {
      const search = registerMfe(db, "Payee search", { repository });
      const { application } = onboardApplication(db, "Payments workspace", { launch: { kind: "mfe", microfrontend: search.publicId, mode: "module_federation_2", exposedModule: "./App" }, placements: [placement(access, "/payments")] });
      expect(applicationReadiness(db, getApplication(db, application.publicId)).checks.find((check) => check.code === "placement.approved")).toMatchObject({ state: "fail", message: "No placement is approved yet" });
      decide(db, placementsOf(db, application.publicId)[0]!, "approve");
      expect(getApplication(db, application.publicId).lifecycle).toBe("ready");

      observeCdaas(db, getMicrofrontend(db, search.publicId), { outcome: "unavailable", error: "CDaaS didn't answer in time" }, new Date(Date.now() + 1000));
      const readiness = applicationReadiness(db, getApplication(db, application.publicId), new Date(Date.now() + 2000));
      expect(readiness.ready).toBe(false);
      expect(readiness.checks.find((check) => check.code === "mfe.entry")).toMatchObject({ state: "stale" });
    });

    it("needs no CDaaS view for an external target with no children, and doesn't wait on another Portal's review (External Application needs no CDaaS view)", () => {
      const { application } = onboardApplication(db, "Payments workspace", { ...external({ mode: "iframe", documentUrl: "https://payments.example.com/app" }), placements: [placement(access, "/payments"), placement(markets, "/payments")] });
      decide(db, placementsOf(db, application.publicId)[0]!, "approve");
      const readiness = applicationReadiness(db, getApplication(db, application.publicId));
      expect(readiness.ready).toBe(true);
      expect(readiness.checks.map((check) => check.code)).toEqual(["application.ownership", "launch.confirmed", "placement.approved"]);
      expect(getApplication(db, application.publicId).lifecycle).toBe("ready");
    });

    it("retires with a reason only once no placement is active", () => {
      const { application } = onboardApplication(db, "Payments workspace", { ...external({ mode: "iframe", documentUrl: "https://payments.example.com/app" }), placements: [placement(access, "/payments")] });
      const [placementId] = placementsOf(db, application.publicId);
      decide(db, placementId!, "approve");
      const current = () => getApplication(db, application.publicId);
      expect(() => retireWebApplication(db, application.publicId, { lockVersion: current().lockVersion, reason: "Replaced", actor: cy })).toThrow(/still placed in Access/);
      decide(db, placementId!, "withdraw", { actor: ana });
      expect(retireWebApplication(db, application.publicId, { lockVersion: current().lockVersion, reason: "Replaced", actor: cy }).lifecycle).toBe("retired");
      expect(() => startApplicationDraft(db, application.publicId, ana)).toThrow(/retired/);
    });
  });

  describe("v2 Drafts and v1 history", () => {
    it("records the environment catalog a revision's placements were checked against, and refuses v1 fields in a Draft", () => {
      const { application } = onboardApplication(db, "Payments workspace", { ...external({ mode: "iframe", documentUrl: "https://payments.example.com/app" }), placements: [placement(access, "/payments")] });
      expect(applicationRevisionView(db, application.activeRevisionId!).catalog).toEqual({ source: "fallback", digest: catalogDigest(FALLBACK_ENVIRONMENTS) });
      expect(db.$client.prepare("select format_version as version, required_capabilities as capabilities from application_revisions where id = ?").get(application.activeRevisionId)).toEqual({ version: 2, capabilities: null });
      expect(db.$client.prepare("select count(*) as n from application_environments").get()).toEqual({ n: 0 });
      const draft = startApplicationDraft(db, application.publicId, ana);
      for (const field of [{ environments: ["prod"] }, { requiredCapabilities: ["navigation"] }, { hostContract: {} }]) {
        expect(() => saveApplicationDraft(db, application.publicId, { lockVersion: draft.lockVersion, document: { ...readApplicationDraft(draft), ...field } })).toThrow(ValidationError);
      }
      expect(() => saveApplicationDraft(db, application.publicId, { lockVersion: draft.lockVersion, document: { ...readApplicationDraft(draft), children: [{ microfrontend: "mfe_aaaaaaaaaaaaaaaa", mountKind: "slot", mountKey: "x", required: true, hostConfiguration: { a: 1 } }] } })).toThrow(ValidationError);
    });

    it("starts a v2 Draft from a v1 revision, keeping its environments, capabilities, and host configuration as history, and submits it as v2", () => {
      const v1 = migratedV1Database();
      try {
        const approvals = getApplication(v1, (v1.$client.prepare("select public_id as id from applications where name = 'Payments approvals'").get() as { id: string }).id);
        const draft = startApplicationDraft(v1, approvals.publicId, ana);
        expect(draft).toMatchObject({ number: 2, formatVersion: 2, document: { legacy: { fromRevision: 1, values: { environments: ["prod", "uat"], requiredCapabilities: ["navigation"] } } } });
        expect(readApplicationDraft(draft).placements.map((item) => [item.route, item.entitlements])).toEqual([["/approvals", { codes: ["PAYMENTS_APPROVER"], operator: "any" }]]);
        const result = submitApplication(v1, approvals.publicId, { lockVersion: draft.lockVersion, actor: ana });
        expect(result).toMatchObject({ submitted: true, revision: { number: 2, formatVersion: 2 } });
        expect(result.revision.document).not.toHaveProperty("legacy");
        expect(v1.$client.prepare("select r.number, count(e.id) as environments from application_revisions r left join application_environments e on e.application_revision_id = r.id where r.application_id = ? group by r.id order by r.number").all(approvals.id)).toEqual([
          { number: 1, environments: 2 },
          { number: 2, environments: 0 },
        ]);
      } finally {
        v1.$client.close();
      }
    });
  });

  it("observes CDaaS views without changing an Application", () => {
    const search = registerMfe(db, "Payee search", { repository });
    const { application } = onboardApplication(db, "Payments workspace", { launch: { kind: "mfe", microfrontend: search.publicId, mode: "module_federation_2", exposedModule: "./App" } });
    observeCdaas(db, getMicrofrontend(db, search.publicId), { outcome: "found", projection: cdaasView("payee", "payee-search", 3) });
    expect(getApplication(db, application.publicId).activeRevisionId).toBe(application.activeRevisionId);
  });
});
