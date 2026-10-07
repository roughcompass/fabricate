import type { Db } from "../../src/lib/db/client";
import { createWebApplication, readApplicationDraft, saveApplicationDraft, startApplicationDraft, submitApplication } from "../../src/lib/onboarding/applications";
import { statedActor } from "../../src/lib/onboarding/attribution";
import { catalogFromStudio, recordCatalogRead } from "../../src/lib/onboarding/environments";
import { getMicrofrontend, retireMicrofrontend, startMicrofrontendDraft } from "../../src/lib/onboarding/microfrontends";
import { savePortalDraft, startPortalDraft, submitPortal } from "../../src/lib/onboarding/portals";
import { buildSource } from "../../test/support/builders";
import { CHILD_RENDERING, MFE_RENDERING, activate, applicationDraft, cdaasView, decide, observeCdaas, observeStudio, onboardApplication, onboardPortal, placementsOf, portalDraft, registerMfe } from "../../test/support/onboarding";
import { loadV1Fixture } from "../../test/support/onboarding-v1";
import type { Surface } from "./surfaces";

const ana = statedActor("ana@example.com");

const placement = (portal: string, route: string, overrides: Record<string, unknown> = {}) => ({ placement: null, portal, menuParent: "payments", route, label: "Payments", order: 1, environments: ["uat", "prod"], entitlements: { codes: [], operator: "any" as const }, defaultRequested: false, ...overrides });

/**
 * Seeds Web Onboarding records in each state a page shows differently, and
 * returns their surfaces:
 * - Portals: one Active with default routes, one Ready but not activated, with a Draft open, one
 *   whose newer revision stops enabling an environment a pending request needs, with a Draft saved
 *   with errors, and one with a long, nested menu
 * - MFEs: confirmed by CDaaS and shared by two Applications, unknown, conflicting, and retired, and
 *   an MFE Draft opened from an Application's composition
 * - Web Applications: a managed Module Federation 2 composite approved in one Portal and rejected
 *   in another, an external ESM host composing a shared MFE, external iframe and Module Federation 2
 *   targets pending review, Drafts with conflicting and unknown rendering evidence, and the
 *   Register MFE page
 * - Placement reviews: pending, approved as a default, rejected, approved with a newer request
 *   pending, withdrawn, retired, and in an environment the Portal no longer enables, with Studio
 *   menu evidence that conflicts and that's stale
 */
export function seedOnboardingSurfaces(db: Db): Surface[] {
  const access = onboardPortal(db, "Access");
  const markets = onboardPortal(db, "Markets", { sealId: "88002" });

  const monorepo = buildSource(db, { name: "payee-monorepo" });
  const hub = registerMfe(db, "Payee hub", { repository: monorepo, workspacePath: "apps/hub", rendering: MFE_RENDERING });
  const search = registerMfe(db, "Payee search", { repository: monorepo, workspacePath: "apps/search", rendering: CHILD_RENDERING });
  observeCdaas(db, hub, { outcome: "found", projection: cdaasView("payee", "payee-hub", 3) });

  const composite = onboardApplication(db, "Payee hub", {
    launch: { kind: "mfe", microfrontend: hub.publicId, mode: "module_federation_2", exposedModule: "./App" },
    children: [{ microfrontend: search.publicId, mountKind: "slot", mountKey: "search", required: true, module: "./Widget" }],
    placements: [placement(access.publicId, "/payee", { defaultRequested: true }), placement(markets.publicId, "/payee")],
  }).application;
  const [inAccess, inMarkets] = placementsOf(db, composite.publicId);
  decide(db, inAccess!, "approve", { accepted: { defaults: ["uat", "prod"] } });
  decide(db, inMarkets!, "reject", { reason: "Markets serves payees from its own workspace" });
  activate(db, access);
  const consoleApp = onboardApplication(db, "Payments console", {
    launch: { kind: "external", mode: "esm", moduleUrl: "https://cdn.example.com/console.js", exportedModule: "mount" },
    children: [{ microfrontend: hub.publicId, mountKind: "route", mountKey: "/payee", required: true, module: null }],
    placements: [placement(access.publicId, "/console")],
  }).application;
  const reporting = onboardApplication(db, "Payments reporting", { launch: { kind: "external", mode: "iframe", documentUrl: "https://payments.example.com/reports", sandbox: ["allow-scripts"] }, placements: [placement(access.publicId, "/reports")] }).application;
  const federated = onboardApplication(db, "Payments analytics", { launch: { kind: "external", mode: "module_federation_2", manifestUrl: "https://cdn.example.com/analytics/mf-manifest.json", exposedModule: "./Analytics" }, placements: [placement(markets.publicId, "/analytics")] }).application;
  startMicrofrontendDraft(db, hub.publicId, ana);
  startPortalDraft(db, markets.publicId, ana);

  // Reviews in every state, with Studio evidence that conflicts and that has gone stale.
  const [reportingInAccess] = placementsOf(db, reporting.publicId);
  decide(db, reportingInAccess!, "approve");
  const menu = (name: string, codes: string[]) => ({ outcome: "found" as const, projection: { uuid: "9c4d", name, parentUuid: null, channelUuid: null, envId: 2, route: "/reports", moduleUuids: [], entitlementCodes: codes } });
  observeStudio(db, { kind: "placement", id: placementId(db, reportingInAccess!) }, "menu", "9c4d", menu("Reports", ["ACCESS"]), "prod");
  observeStudio(db, { kind: "placement", id: placementId(db, inAccess!) }, "menu", "5e1a", menu("Payments", []), "uat", new Date(Date.now() - 3 * 24 * 60 * 60_000));
  observeStudio(db, { kind: "placement", id: placementId(db, inAccess!) }, "menu", "5e1a", { outcome: "unavailable", error: "Studio didn't answer in time" }, "uat");
  const resubmitted = startApplicationDraft(db, reporting.publicId, ana);
  const revised = readApplicationDraft(resubmitted);
  revised.placements = revised.placements.map((item) => ({ ...item, label: "Reports" }));
  const saved = saveApplicationDraft(db, reporting.publicId, { lockVersion: resubmitted.lockVersion, document: revised });
  submitApplication(db, reporting.publicId, { lockVersion: saved.lockVersion, actor: ana });
  const withdrawn = onboardApplication(db, "Payments archive", { launch: { kind: "external", mode: "iframe", documentUrl: "https://payments.example.com/archive" }, placements: [placement(access.publicId, "/archive")] }).application;
  decide(db, placementsOf(db, withdrawn.publicId)[0]!, "withdraw", { reason: "Folded into reporting" });
  const retiredPlacement = onboardApplication(db, "Payments legacy", { launch: { kind: "external", mode: "iframe", documentUrl: "https://payments.example.com/legacy" }, placements: [placement(access.publicId, "/legacy")] }).application;
  decide(db, placementsOf(db, retiredPlacement.publicId)[0]!, "approve");
  decide(db, placementsOf(db, retiredPlacement.publicId)[0]!, "retire", { reason: "Replaced by Payments reporting, which serves the same statements with entitlements per environment and a long explanation that wraps across lines" });
  const [consoleInAccess] = placementsOf(db, consoleApp.publicId);

  // A Portal whose newer revision stops enabling an environment a pending request names, with a Draft saved with errors.
  const intranet = onboardPortal(db, "Intranet", { sealId: "88003" });
  const intranetApp = onboardApplication(db, "Payee hub intranet", { launch: { kind: "mfe", microfrontend: hub.publicId, mode: "module_federation_2", exposedModule: "./App" }, placements: [placement(intranet.publicId, "/payee")] }).application;
  const [inIntranet] = placementsOf(db, intranetApp.publicId);
  const prodOnly = startPortalDraft(db, intranet.publicId, ana);
  const narrowed = savePortalDraft(db, intranet.publicId, { lockVersion: prodOnly.lockVersion, document: portalDraft({ sealId: "88003", environments: ["prod"] }) });
  submitPortal(db, intranet.publicId, { lockVersion: narrowed.lockVersion, actor: ana });
  const broken = startPortalDraft(db, intranet.publicId, ana);
  savePortalDraft(db, intranet.publicId, {
    lockVersion: broken.lockVersion,
    document: portalDraft({
      ownerTeam: null,
      sealId: "88003",
      environments: ["qa", "prod", "prod"],
      menu: [
        { key: "payments", label: "Payments", parent: null, order: 1 },
        { key: "payments", label: "Payments again", parent: "missing", order: 2 },
      ],
    }),
  });

  // A Portal with a long, nested menu.
  const groups = ["Payments", "Cards", "Lending", "Wealth", "Treasury", "Markets", "Reporting", "Operations"].flatMap((top, index) => [
    { key: top.toLowerCase(), label: top, parent: null, order: index + 1 },
    ...["Overview", "Approvals", "Exceptions with a long label that wraps across lines"].map((child, position) => ({ key: `${top.toLowerCase()}-${position}`, label: `${top} ${child}`, parent: top.toLowerCase(), order: position + 1 })),
  ]);
  const wealth = onboardPortal(db, "Wealth workspace", { sealId: "88004", menu: groups });

  // Drafts whose rendering evidence conflicts, and whose evidence is unknown.
  const lookup = registerMfe(db, "Payee lookup", { repository: monorepo, workspacePath: "apps/lookup", rendering: { iframe: null, esm: { exports: ["./App"] }, module_federation_2: { exposes: ["./App"] } } });
  observeStudio(db, { kind: "microfrontend", id: lookup.id }, "module", "7a2e", { outcome: "found", projection: { uuid: "7a2e", title: "Payee lookup", appId: "payee", url: "https://payee.example.com/lookup", sealId: "88001", status: "Active", version: 2, typeLabels: ["iframe"] } });
  const conflicted = draftApplication(db, "Payee lookup", { launch: { kind: "mfe", microfrontend: lookup.publicId, mode: null } });
  const unknown = registerMfe(db, "Payee details", { repository: monorepo, workspacePath: "apps/details", rendering: CHILD_RENDERING, confirmed: false });
  observeCdaas(db, unknown, { outcome: "unavailable", error: "CDaaS didn't answer in time" });
  observeStudio(db, { kind: "microfrontend", id: unknown.id }, "module", "8b3f", { outcome: "unavailable", error: "Studio didn't answer in time" });
  const unconfirmed = draftApplication(db, "Payee details", { launch: { kind: "mfe", microfrontend: unknown.publicId, mode: "esm", exportedModule: "./Widget" }, placements: [placement(access.publicId, "/payee")] });

  const conflicting = registerMfe(db, "Payee history", { repository: monorepo, workspacePath: "apps/history", rendering: CHILD_RENDERING, confirmed: false });
  observeCdaas(db, conflicting, { outcome: "found", projection: cdaasView("payee", "payee-history-v2") });
  const retired = registerMfe(db, "Payee export", { repository: buildSource(db, { name: "payee-export" }), rendering: CHILD_RENDERING });
  retireMicrofrontend(db, retired.publicId, { lockVersion: getMicrofrontend(db, retired.publicId).lockVersion, reason: "Replaced by the reports MFE", actor: ana });

  const portal = (publicId: string, rest = "") => `/onboarding/portals/${publicId}${rest}`;
  const mfe = (publicId: string, rest = "") => `/onboarding/microfrontends/${publicId}${rest}`;
  const app = (publicId: string, rest = "") => `/onboarding/applications/${publicId}${rest}`;
  const review = (publicId: string) => `/onboarding/reviews/${publicId}`;
  return [
    ["20-portals", "/onboarding/portals"],
    ["20-portal-new", "/onboarding/portals/new"],
    ["20-portal-active", portal(access.publicId)],
    ["20-portal-ready", portal(markets.publicId)],
    ["20-portal-revision", portal(access.publicId, "/revisions/1")],
    ["20-portal-draft-identity", portal(markets.publicId, "/draft/identity")],
    ["20-portal-draft-environments", portal(markets.publicId, "/draft/environments")],
    ["20-portal-draft-menu", portal(markets.publicId, "/draft/menu")],
    ["20-portal-draft-review", portal(markets.publicId, "/draft/review")],
    ["20-portal-draft-errors-identity", portal(intranet.publicId, "/draft/identity")],
    ["20-portal-draft-errors-environments", portal(intranet.publicId, "/draft/environments")],
    ["20-portal-draft-errors-menu", portal(intranet.publicId, "/draft/menu")],
    ["20-portal-draft-errors-review", portal(intranet.publicId, "/draft/review")],
    ["20-portal-narrowed-revision", portal(intranet.publicId, "/revisions/2")],
    ["20-portal-long-menu", portal(wealth.publicId)],
    ["20-portal-long-menu-revision", portal(wealth.publicId, "/revisions/1")],
    ["21-mfes", "/onboarding/microfrontends"],
    ["21-mfe-shared", mfe(hub.publicId)],
    ["21-mfe-from-application", mfe(hub.publicId, `?from=${consoleApp.publicId}`)],
    ["21-mfe-unknown", mfe(unknown.publicId)],
    ["21-mfe-conflicting", mfe(conflicting.publicId)],
    ["21-mfe-retired", mfe(retired.publicId)],
    ["21-mfe-revision", mfe(hub.publicId, "/revisions/1")],
    ["21-mfe-draft-identity", mfe(hub.publicId, "/draft/identity")],
    ["21-mfe-draft-source", mfe(hub.publicId, "/draft/source")],
    ["21-mfe-draft-cdaas", mfe(hub.publicId, "/draft/cdaas")],
    ["21-mfe-draft-rendering", mfe(hub.publicId, "/draft/rendering")],
    ["21-mfe-draft-rendering-from-application", mfe(hub.publicId, `/draft/rendering?from=${consoleApp.publicId}`)],
    ["21-mfe-draft-review", mfe(hub.publicId, "/draft/review")],
    ["22-applications", "/onboarding/applications"],
    ["22-application-new", "/onboarding/applications/new"],
    ["22-application-composite", app(composite.publicId)],
    ["22-application-external-esm", app(consoleApp.publicId)],
    ["22-application-external-iframe", app(reporting.publicId)],
    ["22-application-external-mf2", app(federated.publicId)],
    ["22-application-revision", app(composite.publicId, "/revisions/1")],
    ["22-application-draft-identity", app(unconfirmed.publicId, "/draft/identity")],
    ["22-application-draft-launch-conflict", app(conflicted.publicId, "/draft/launch")],
    ["22-application-draft-launch-unknown", app(unconfirmed.publicId, "/draft/launch")],
    ["22-application-draft-composition", app(conflicted.publicId, "/draft/composition")],
    ["22-application-draft-composition-search", app(conflicted.publicId, "/draft/composition?q=payee")],
    ["22-application-register-mfe", app(conflicted.publicId, "/microfrontends/new")],
    ["22-application-draft-placements", app(unconfirmed.publicId, "/draft/placements")],
    ["22-application-draft-review", app(unconfirmed.publicId, "/draft/review")],
    ["23-reviews", "/onboarding/reviews"],
    ["23-reviews-pending-access", `/onboarding/reviews?state=pending&portal=${access.publicId}`],
    ["23-review-pending", review(consoleInAccess!)],
    ["23-review-approved-default", review(inAccess!)],
    ["23-review-rejected", review(inMarkets!)],
    ["23-review-served-under-newer-request", review(reportingInAccess!)],
    ["23-review-withdrawn", review(placementsOf(db, withdrawn.publicId)[0]!)],
    ["23-review-retired", review(placementsOf(db, retiredPlacement.publicId)[0]!)],
    ["23-review-approve-inline", `${review(consoleInAccess!)}?dialog=approve`],
    ["23-review-environment-mismatch", review(inIntranet!)],
  ];
}

/**
 * Loads the onboarding v1 fixture, then reads Studio's environment list, and
 * returns the surfaces that show v1 history and Drafts converted from it:
 * v1 revisions of a Portal, Application, and MFE; a converted Portal Draft
 * with its kept runtimes and entitlements; a Portal Draft naming an
 * environment the catalog doesn't list; a converted MFE Draft with a
 * migration issue; and a converted Application Draft. Load it into an empty
 * database: the fixture names its own IDs.
 */
export function seedV1Surfaces(db: Db): Surface[] {
  loadV1Fixture(db);
  recordCatalogRead(db, { outcome: "found", environments: catalogFromStudio([{ id: 1, label: "DEV" }, { id: 2, label: "UAT" }, { id: 4, label: "PROD" }]).environments });
  const id = (table: string, column: string, name: string) => (db.$client.prepare(`select public_id as id from ${table} where ${column} = ?`).get(name) as { id: string }).id;
  const access = id("portals", "label", "Access");
  const treasury = id("portals", "label", "Treasury");
  const hub = id("applications", "name", "Payee hub");
  const frames = id("microfrontends", "name", "Payee frames");
  const hubMfe = id("microfrontends", "name", "Payee hub");
  return [
    ["24-v1-portal-revision", `/onboarding/portals/${access}/revisions/1`],
    ["24-v1-portal-converted-identity", `/onboarding/portals/${access}/draft/identity`],
    ["24-v1-portal-converted-environments", `/onboarding/portals/${access}/draft/environments`],
    ["24-v1-portal-unlisted-environment", `/onboarding/portals/${treasury}/draft/environments`],
    ["24-v1-application-revision", `/onboarding/applications/${hub}/revisions/1`],
    ["24-v1-application-converted-identity", `/onboarding/applications/${hub}/draft/identity`],
    ["24-v1-mfe-revision", `/onboarding/microfrontends/${hubMfe}/revisions/1`],
    ["24-v1-mfe-converted-rendering", `/onboarding/microfrontends/${frames}/draft/rendering`],
    ["24-v1-mfe-converted-identity", `/onboarding/microfrontends/${frames}/draft/identity`],
  ];
}

function placementId(db: Db, publicId: string): number {
  return (db.$client.prepare("select id from application_placements where public_id = ?").get(publicId) as { id: number }).id;
}

/** An Application with a saved, unsubmitted first Draft. */
function draftApplication(db: Db, name: string, spec: Parameters<typeof applicationDraft>[0]) {
  const { application, draft } = createWebApplication(db, { name, ownerTeam: "Payments", sealId: "88001" }, ana);
  saveApplicationDraft(db, application.publicId, { lockVersion: draft.lockVersion, document: applicationDraft({ name, ...spec }) });
  return application;
}
