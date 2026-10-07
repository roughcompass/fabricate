import { compareCodeUnits } from "@repo-facts/contract";
import type { Db } from "@/lib/db/client";
import { applicationName, applicationRevisionView, getApplication, placementStatesOf } from "@/lib/onboarding/applications";
import { getMicrofrontend, microfrontendUses } from "@/lib/onboarding/microfrontends";
import { currentDefault } from "@/lib/onboarding/placements";
import { getPortal, governingRevision, portalRevisionView } from "@/lib/onboarding/portals";
import { buildSource } from "./builders";
import { CHILD_RENDERING, MFE_RENDERING, activate, decide, onboardApplication, onboardPortal, placementsOf, registerMfe } from "./onboarding";

/*
 * The onboarding acceptance fixture: Access, a configuration-only Portal, and
 * Markets; two Applications sharing SEAL ID 88001; Payee search, an MFE both
 * use; Payee hub, a managed Module Federation 2 composite; Payments reporting,
 * an external iframe Application; and placements Access and Markets decide on
 * their own, each naming its environments and the entitlements a visitor
 * needs. Public IDs are random, so the fixture is compared by the
 * relationships it describes, by name; seeded with fixed IDs and a fixed
 * clock, it's identical down to every digest.
 */

const request = (portal: string, route: string, overrides: Record<string, unknown> = {}) => ({ placement: null, portal, menuParent: "payments", route, label: "Payments", order: 1, environments: ["uat", "prod"], entitlements: { codes: [], operator: "any" as const }, defaultRequested: false, ...overrides });

export function seedAcceptance(db: Db) {
  const access = onboardPortal(db, "Access");
  const markets = onboardPortal(db, "Markets", { sealId: "88002" });
  const monorepo = buildSource(db, { name: "payee-monorepo" });
  const hub = registerMfe(db, "Payee hub", { repository: monorepo, workspacePath: "apps/hub", rendering: MFE_RENDERING });
  const search = registerMfe(db, "Payee search", { repository: monorepo, workspacePath: "apps/search", rendering: CHILD_RENDERING });

  const composite = onboardApplication(
    db,
    "Payee hub",
    {
      launch: { kind: "mfe", microfrontend: hub.publicId, mode: "module_federation_2", exposedModule: "./App" },
      children: [{ microfrontend: search.publicId, mountKind: "slot", mountKey: "search", required: true, module: "./Widget" }],
      placements: [request(access.publicId, "/payee", { defaultRequested: true, entitlements: { codes: ["PAYEE_VIEW"], operator: "any" } }), request(markets.publicId, "/payee", { environments: ["prod"] })],
    },
    { candidate: "agreed" },
  ).application;
  const reporting = onboardApplication(db, "Payments reporting", {
    launch: { kind: "external", mode: "iframe", documentUrl: "https://payments.example.com/reports", sandbox: ["allow-scripts"] },
    children: [{ microfrontend: search.publicId, mountKind: "route", mountKey: "/reports/search", required: false, module: null }],
    placements: [request(access.publicId, "/reports", { environments: ["prod"], entitlements: { codes: ["REPORTS_VIEW", "PAYMENTS_ADMIN"], operator: "all" } })],
  }).application;

  const [compositeInAccess, compositeInMarkets] = placementsOf(db, composite.publicId);
  decide(db, compositeInAccess!, "approve", { accepted: { defaults: ["uat", "prod"] } });
  decide(db, compositeInMarkets!, "reject", { reason: "Markets serves payees from its own workspace" });
  decide(db, placementsOf(db, reporting.publicId)[0]!, "approve");
  activate(db, access);
  // Read again: the decisions above changed their lifecycles.
  return {
    access: getPortal(db, access.publicId),
    markets: getPortal(db, markets.publicId),
    hub: getMicrofrontend(db, hub.publicId),
    search: getMicrofrontend(db, search.publicId),
    composite: getApplication(db, composite.publicId),
    reporting: getApplication(db, reporting.publicId),
  };
}

/** What the fixture's records are to one another, by name: everything but their random IDs. */
export function acceptanceRelationships(db: Db) {
  const { access, markets, hub, search, composite, reporting } = seedAcceptance(db);
  const portal = (record: typeof access) => {
    const governing = governingRevision(db, record)!;
    const view = portalRevisionView(db, record, governing);
    return {
      name: record.label,
      sealId: record.sealId,
      lifecycle: record.lifecycle,
      environments: view.environments.map((environment) => environment.environment),
      menu: view.menu.map((group) => group.key),
      defaults: view.environments.map((environment) => {
        const current = currentDefault(db, record.id, environment.environment);
        const owner = current.placement ? [composite, reporting].find((application) => placementsOf(db, application.publicId).includes(current.placement!)) : undefined;
        return [environment.environment, owner ? applicationName(owner) : null];
      }),
    };
  };
  const mfe = (record: typeof hub) => ({ name: record.name, lifecycle: record.lifecycle, cdaas: `${record.cdaasAppId}/${record.cdaasViewId}`, usedBy: microfrontendUses(db, record.id).map((use) => [use.application.name, use.role, use.mount]) });
  const application = (record: typeof composite) => {
    const view = applicationRevisionView(db, record.activeRevisionId!);
    return {
      name: applicationName(record),
      sealId: record.sealId,
      lifecycle: record.lifecycle,
      launch: view.target ? [view.target.target.kind, view.target.target.renderingMode, view.target.target.confirmation, view.target.microfrontend?.name ?? null] : null,
      components: view.components.map((row) => [row.microfrontend.name, row.component.role, row.component.mountKey]),
      placements: placementStatesOf(db, record.id)
        .map((state) => {
          const requested = view.requests.find((row) => row.placement.publicId === state.placement)!;
          const entitlements = JSON.parse(requested.request.entitlements) as { codes: string[]; operator: string };
          return [state.portalName, state.latest, state.effective, requested.environments, `${entitlements.operator}: ${entitlements.codes.join(", ") || "none"}`];
        })
        .sort((a, b) => compareCodeUnits(String(a[0]), String(b[0]))),
    };
  };
  return { portals: [portal(access), portal(markets)], mfes: [mfe(hub), mfe(search)], applications: [application(composite), application(reporting)] };
}
