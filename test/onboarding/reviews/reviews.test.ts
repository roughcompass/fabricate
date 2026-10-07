import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/lib/db/client";
import { TransitionError, ValidationError } from "@/lib/db/errors";
import * as applications from "@/lib/onboarding/applications";
import { getApplication, placementChecks, placementStatesOf } from "@/lib/onboarding/applications";
import { statedActor } from "@/lib/onboarding/attribution";
import { BlockedError } from "@/lib/onboarding/issues";
import { activeRoutes, currentDefault } from "@/lib/onboarding/placements";
import { getPortal, retirePortal, savePortalDraft, startPortalDraft, submitPortal } from "@/lib/onboarding/portals";
import { StaleDecisionError, decidePlacement, placementReview, reviewQueue, reviewTitle } from "@/lib/onboarding/reviews";
import { createTestDb, rawRun } from "../../support/db";
import { activate, ana, cy, decide, onboardApplication, onboardPortal, placementsOf, portalDraft } from "../../support/onboarding";
import { migratedV1Database } from "../../support/onboarding-v1";

const dee = statedActor("dee@example.com");
const iframe = { kind: "external" as const, mode: "iframe" as const, documentUrl: "https://payments.example.com/app" };
const request = (portal: string, route: string, overrides: Record<string, unknown> = {}) => ({ placement: null as string | null, portal, menuParent: "payments", route, label: "Payments", order: 1, environments: ["uat", "prod"], entitlements: { codes: [], operator: "any" as const }, defaultRequested: false, ...overrides });

describe("placement reviews", () => {
  let db: Db;
  let access: string;
  let markets: string;
  let digital: string;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    db = createTestDb();
    access = onboardPortal(db, "Access").publicId;
    markets = onboardPortal(db, "Markets").publicId;
    digital = onboardPortal(db, "Digital Bank").publicId;
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    // Reviews never reach Studio, CDaaS, or ServiceNow (Approved placement).
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  const app = (name = "Payments workspace", requests = [request(access, "/payments"), request(markets, "/payments"), request(digital, "/payments")]) => onboardApplication(db, name, { launch: iframe, placements: requests }).application;

  it("reviews each Portal's placement independently, activating each approval without waiting for the others (Multi-Portal review)", () => {
    const application = app();
    const [inAccess, inMarkets, inDigital] = placementsOf(db, application.publicId);
    decide(db, inAccess!, "approve");
    expect(activeRoutes(db, getPortal(db, access).id).map((route) => [route.environment, route.route])).toEqual([
      ["prod", "/payments"],
      ["uat", "/payments"],
    ]);
    expect(placementStatesOf(db, application.id).map((state) => [state.portalName, state.latest])).toEqual([
      ["Access", "approved"],
      ["Digital Bank", "pending"],
      ["Markets", "pending"],
    ]);
    decide(db, inMarkets!, "reject", { reason: "Markets has its own" });
    decide(db, inDigital!, "withdraw", { actor: ana });
    expect(placementStatesOf(db, application.id).map((state) => [state.portalName, state.latest])).toEqual([
      ["Access", "approved"],
      ["Digital Bank", "withdrawn"],
      ["Markets", "rejected"],
    ]);
    expect(getApplication(db, application.publicId).lifecycle).toBe("ready");
  });

  it("records the exact Portal, Application, and placement revisions each decision evaluated", () => {
    const application = app("Payments workspace", [request(access, "/payments")]);
    const [placement] = placementsOf(db, application.publicId);
    decide(db, placement!, "approve");
    const review = placementReview(db, placement!)!;
    expect(reviewTitle(review)).toBe("Payments workspace · Access");
    expect(review.decisions.map((view) => [view.decision.decision, view.portalRevision, view.applicationRevision, view.decision.placementRequestId === review.request.id, view.decision.actor, view.decision.attribution])).toEqual([
      ["approve", 1, 1, true, "cy@example.com", "unverified"],
    ]);
  });

  it("records the values the Portal owner accepts, not the requested ones, and makes the first default in the same transaction", () => {
    const application = app("Payments workspace", [request(access, "/payments", { label: "Payments", order: 4, defaultRequested: true, entitlements: { codes: ["PAY"], operator: "any" } })]);
    const [placement] = placementsOf(db, application.publicId);
    const decision = decide(db, placement!, "approve", { accepted: { route: "/pay//", label: "Pay", order: 1, entitlements: { codes: ["PAY", "ACCESS"], operator: "all" }, defaults: ["prod"] } });
    expect(decision).toMatchObject({ acceptedRoute: "/pay", acceptedLabel: "Pay", acceptedOrdering: 1, acceptedEntitlements: '{"codes":["ACCESS","PAY"],"operator":"all"}', acceptedDefaults: '["prod"]' });
    const portal = getPortal(db, access);
    expect(activeRoutes(db, portal.id).map((route) => [route.environment, route.route, route.label])).toEqual([
      ["prod", "/pay", "Pay"],
      ["uat", "/pay", "Pay"],
    ]);
    expect([currentDefault(db, portal.id, "prod").placement, currentDefault(db, portal.id, "uat").placement]).toEqual([placement, null]);
    expect(db.$client.prepare("select decision_id from portal_default_routes").all()).toEqual([{ decision_id: decision.id }]);

    // A default requested where none exists is assigned with the approval.
    const second = app("Payments reporting", [request(access, "/reports", { defaultRequested: true })]);
    decide(db, placementsOf(db, second.publicId)[0]!, "approve");
    expect(currentDefault(db, portal.id, "uat").placement).toBe(placementsOf(db, second.publicId)[0]);
    expect(currentDefault(db, portal.id, "prod").placement).toBe(placement);
  });

  it("refuses an approval that would collide, or names a menu group the Portal hasn't got, and writes nothing", () => {
    const first = app("Payments workspace", [request(access, "/payments", { environments: ["prod"] })]);
    const second = app("Payments reporting", [request(access, "/reports", { environments: ["prod"] })]);
    decide(db, placementsOf(db, first.publicId)[0]!, "approve");
    const pending = placementsOf(db, second.publicId)[0]!;
    expect(() => decide(db, pending, "approve", { accepted: { route: "/payments" } })).toThrow(/Access PROD already serves \/payments for Payments workspace/);
    expect(() => decide(db, pending, "approve", { accepted: { menuParent: "tools" } })).toThrow(/has no menu group tools/);
    expect(() => decide(db, pending, "approve", { accepted: { defaults: ["uat"] } })).toThrow(/isn't requested in UAT/);
    expect(placementReview(db, pending)).toMatchObject({ state: "pending", sequence: 0 });
    expect(db.$client.prepare("select count(*) as n from placement_decisions").get()).toEqual({ n: 1 });
  });

  it("requires a reason to reject or retire, and allows only the transitions of its state", () => {
    const application = app("Payments workspace", [request(access, "/payments")]);
    const [placement] = placementsOf(db, application.publicId);
    const attempt = (decision: "approve" | "reject" | "withdraw" | "retire", sequence: number, reason: string | null = null, revision = 1) => () => decidePlacement(db, { placement: placement!, revision, expectedSequence: sequence, decision, reason, actor: cy });
    expect(attempt("reject", 0)).toThrow(ValidationError);
    expect(attempt("retire", 0, "Gone")).toThrow(/A pending placement can't be retired/);
    attempt("approve", 0)();
    expect(attempt("approve", 1)).toThrow(/An approved placement can't be approved/);
    expect(attempt("reject", 1, "Too late")).toThrow(TransitionError);
    expect(attempt("retire", 1)).toThrow(/Say why/);
    attempt("retire", 1, "Moved to Markets")();
    expect(attempt("withdraw", 2)).toThrow(/A retired placement can't be withdrawn/);
    expect(attempt("approve", 0, null, 9)).toThrow(/doesn't request this placement/);
    expect(placementReview(db, placement!)!.decisions.map((view) => [view.decision.decision, view.decision.reason])).toEqual([
      ["approve", null],
      ["retire", "Moved to Markets"],
    ]);
    expect(() => rawRun(db, "delete from placement_decisions")).toThrow(/retained/);
  });

  it("refuses a stale decision, keeping the newer one current (Two reviewers act on one placement)", () => {
    const application = app("Payments workspace", [request(access, "/payments")]);
    const [placement] = placementsOf(db, application.publicId);
    const opened = placementReview(db, placement!)!.sequence;
    decidePlacement(db, { placement: placement!, revision: 1, expectedSequence: opened, decision: "approve", actor: cy });

    let stale: StaleDecisionError | undefined;
    try {
      decidePlacement(db, { placement: placement!, revision: 1, expectedSequence: opened, decision: "reject", reason: "Wrong portal", actor: dee });
    } catch (error) {
      stale = error as StaleDecisionError;
    }
    expect(stale).toBeInstanceOf(StaleDecisionError);
    expect(stale!.message).toBe("This placement was approved by cy@example.com after you opened it");
    expect(stale!.current).toMatchObject({ state: "approved", sequence: 1, latest: { decision: "approve", actor: "cy@example.com" } });
    expect(placementReview(db, placement!)).toMatchObject({ state: "approved", effective: "approved" });
  });

  it("protects an Active Portal's default from withdrawal and retirement until another placement takes over", () => {
    const first = app("Payments workspace", [request(access, "/payments", { defaultRequested: true })]);
    const second = app("Payments reporting", [request(access, "/reports")]);
    const [home] = placementsOf(db, first.publicId);
    const [reports] = placementsOf(db, second.publicId);
    decide(db, home!, "approve");
    decide(db, reports!, "approve");
    activate(db, getPortal(db, access));
    let blocked: BlockedError | undefined;
    try {
      decide(db, home!, "withdraw", { actor: ana });
    } catch (error) {
      blocked = error as BlockedError;
    }
    expect(blocked!.issues.map((issue) => [issue.code, issue.location])).toEqual([
      ["placement.default_protected", "defaults.prod"],
      ["placement.default_protected", "defaults.uat"],
    ]);
    decide(db, home!, "withdraw", { actor: ana, replacementDefaults: { prod: reports!, uat: reports! } });
    const portal = getPortal(db, access);
    expect([currentDefault(db, portal.id, "prod").placement, currentDefault(db, portal.id, "uat").placement]).toEqual([reports, reports]);
    expect(placementReview(db, home!)).toMatchObject({ state: "withdrawn", effective: "withdrawn" });
    expect(activeRoutes(db, portal.id).map((route) => route.placement)).toEqual([reports, reports]);
  });

  it("refuses to approve a request in an environment the Portal no longer enables, naming the environment (Environment mismatch)", () => {
    const application = app("Payments workspace", [request(access, "/payments")]);
    const [placement] = placementsOf(db, application.publicId);
    const draft = startPortalDraft(db, access, ana);
    const saved = savePortalDraft(db, access, { lockVersion: draft.lockVersion, document: portalDraft({ environments: ["prod"] }) });
    expect(submitPortal(db, access, { lockVersion: saved.lockVersion, actor: ana }).submitted).toBe(true);
    let blocked: BlockedError | undefined;
    try {
      decide(db, placement!, "approve");
    } catch (error) {
      blocked = error as BlockedError;
    }
    expect(blocked!.issues.map((issue) => [issue.code, issue.message])).toEqual([["placement.environment_unavailable", "Access has no enabled UAT environment now"]]);
    expect(placementReview(db, placement!)).toMatchObject({ state: "pending", sequence: 0 });
  });

  it("checks only the Portal's environments and routes now, naming the revision it compared (simplified validation evidence)", () => {
    const application = app("Payments workspace", [request(access, "/payments")]);
    const occupant = app("Payments reporting", [request(access, "/payments", { environments: ["prod"] })]);
    decide(db, placementsOf(db, occupant.publicId)[0]!, "approve");
    const [placement] = placementsOf(db, application.publicId);
    const portal = getPortal(db, access);
    const checks = placementChecks(db, { portal, placementId: db.$client.prepare("select id from application_placements where public_id = ?").pluck().get(placement) as number, route: "/payments", environments: ["uat", "prod", "test"] });
    expect(checks.compared).toEqual(["Access revision 1 environments"]);
    expect(checks.issues.map((issue) => [issue.code, issue.message])).toEqual([
      ["placement.route_collision", "Access PROD already serves /payments for Payments reporting"],
      ["placement.environment_unavailable", "Access has no enabled TEST environment now"],
    ]);
    expect(JSON.stringify(checks)).not.toMatch(/contract|capabilit|runtime/i);
  });

  it("decides a placement's entitlements in its review, environment by environment, and stores them on no Portal revision (placement entitlement changes)", () => {
    const application = app("Payments approvals", [request(access, "/approvals", { environments: ["prod"], entitlements: { codes: ["PAYMENTS_APPROVER"], operator: "any" } })]);
    const [placement] = placementsOf(db, application.publicId);
    const decision = decide(db, placement!, "approve", { accepted: { entitlements: { codes: ["PAYMENTS_APPROVER", "PAYMENTS_ADMIN"], operator: "all" } } });
    expect(JSON.parse(decision.acceptedEntitlements!)).toEqual({ codes: ["PAYMENTS_ADMIN", "PAYMENTS_APPROVER"], operator: "all" });
    expect(placementReview(db, placement!)).toMatchObject({ environments: ["prod"], request: { entitlements: '{"codes":["PAYMENTS_APPROVER"],"operator":"any"}' } });
    expect(db.$client.prepare("select count(*) as n from portal_environments where entitlements is not null").get()).toEqual({ n: 0 });
    expect(db.$client.prepare("select runtimes, contract from portal_revisions").all()).toEqual([
      { runtimes: null, contract: null },
      { runtimes: null, contract: null },
      { runtimes: null, contract: null },
    ]);
  });

  it("keeps v1 decisions readable against the revisions they evaluated, and decides new requests under v2 (historical v1 evidence)", () => {
    const v1 = migratedV1Database();
    try {
      const approvals = v1.$client.prepare("select p.public_id from application_placements p join applications a on a.id = p.application_id where a.name = 'Payments approvals'").pluck().get() as string;
      const review = placementReview(v1, approvals)!;
      expect(review).toMatchObject({ state: "approved", revision: 1, environments: ["prod", "uat"] });
      expect(review.decisions.map((view) => [view.decision.decision, view.portalRevision, view.applicationRevision, JSON.parse(view.decision.acceptedEntitlements!)])).toEqual([["approve", 1, 1, { codes: ["PAYMENTS_ADMIN", "PAYMENTS_APPROVER"], operator: "all" }]]);

      // A new v2 revision's request is pending, while the v1 approval keeps serving.
      const application = getApplication(v1, v1.$client.prepare("select public_id from applications where name = 'Payments approvals'").pluck().get() as string);
      const { startApplicationDraft, submitApplication } = applications;
      const draft = startApplicationDraft(v1, application.publicId, ana);
      expect(submitApplication(v1, application.publicId, { lockVersion: draft.lockVersion, actor: ana })).toMatchObject({ submitted: true, revision: { number: 2, formatVersion: 2 } });
      expect(placementReview(v1, approvals)).toMatchObject({ state: "pending", effective: "approved", revision: 2, activeRequest: { revision: 1 } });
    } finally {
      v1.$client.close();
    }
  });

  it("withdraws a newer pending request without touching the earlier approval or the default it holds", () => {
    const application = app("Payments workspace", [request(access, "/payments", { defaultRequested: true })]);
    const [placement] = placementsOf(db, application.publicId);
    decide(db, placement!, "approve");
    activate(db, getPortal(db, access));
    onboardApplicationRevision(application.publicId, [{ ...request(access, "/payments/home"), placement: placement! }]);
    decide(db, placement!, "withdraw", { actor: ana });
    const portal = getPortal(db, access);
    expect(placementReview(db, placement!)).toMatchObject({ state: "withdrawn", effective: "approved", activeRequest: { revision: 1 } });
    expect([currentDefault(db, portal.id, "prod").placement, currentDefault(db, portal.id, "uat").placement]).toEqual([placement, placement]);
    expect(activeRoutes(db, portal.id).map((route) => route.route)).toEqual(["/payments", "/payments"]);
  });

  it("keeps an earlier approval serving while a newer revision's request waits, and switches routes on its approval", () => {
    const application = app("Payments workspace", [request(access, "/payments")]);
    const [placement] = placementsOf(db, application.publicId);
    decide(db, placement!, "approve");
    const { revision } = onboardApplicationRevision(application.publicId, [{ ...request(access, "/payments/home"), placement: placement! }]);
    expect(revision.number).toBe(2);
    expect(placementReview(db, placement!)).toMatchObject({ state: "pending", effective: "approved", revision: 2, activeRequest: { revision: 1 } });
    expect(activeRoutes(db, getPortal(db, access).id).map((route) => route.route)).toEqual(["/payments", "/payments"]);
    decide(db, placement!, "approve");
    expect(activeRoutes(db, getPortal(db, access).id).map((route) => route.route)).toEqual(["/payments/home", "/payments/home"]);
    expect(placementReview(db, placement!)!.history.map((view) => [view.decision.decision, view.applicationRevision])).toEqual([
      ["approve", 1],
      ["approve", 2],
    ]);
    expect(reviewQueue(db).find((row) => row.placement === placement)).toMatchObject({ revision: 2, state: "approved" });
  });

  it("labels every submission, decision, activation, and retirement Unverified, and stores no authority (Portal owner approves in the proof of concept)", () => {
    const application = app("Payments workspace", [request(access, "/payments", { defaultRequested: true })]);
    decide(db, placementsOf(db, application.publicId)[0]!, "approve");
    activate(db, getPortal(db, access));
    retirePortal(db, markets, { lockVersion: getPortal(db, markets).lockVersion, reason: "Not needed", actor: cy });
    const attributions = [
      ...(db.$client.prepare("select attribution from placement_decisions").all() as { attribution: string }[]),
      ...(db.$client.prepare("select attribution from portal_default_routes").all() as { attribution: string }[]),
      ...(db.$client.prepare("select attribution from onboarding_events").all() as { attribution: string }[]),
    ].map((row) => row.attribution);
    expect(new Set(attributions)).toEqual(new Set(["unverified"]));
    const columns = (db.$client.prepare("select name from pragma_table_info('placement_decisions') union select name from pragma_table_info('onboarding_events')").all() as { name: string }[]).map((row) => row.name);
    expect(columns.filter((name) => /token|role|permission|entitle(ment)?_grant|verified_at|authority/.test(name))).toEqual([]);
    expect(() => rawRun(db, "update placement_decisions set attribution = 'verified'")).toThrow(/never changed/);
  });

  it("queues one row per placement, pending first, filtered by state, Portal, and search", () => {
    const first = app("Payments workspace", [request(access, "/payments"), request(markets, "/payments")]);
    app("FX Board", [request(markets, "/fx")]);
    decide(db, placementsOf(db, first.publicId)[0]!, "approve");
    expect(reviewQueue(db).map((row) => [row.application.name, row.portal.name, row.state])).toEqual([
      ["Payments workspace", "Markets", "pending"],
      ["FX Board", "Markets", "pending"],
      ["Payments workspace", "Access", "approved"],
    ]);
    expect(reviewQueue(db, { state: "pending", portal: markets }).map((row) => row.application.name)).toEqual(["Payments workspace", "FX Board"]);
    expect(reviewQueue(db, { search: "fx" }).map((row) => row.route)).toEqual(["/fx"]);
    expect(reviewQueue(db, { search: "ana@" })).toHaveLength(3);
  });

  /** Submits a new revision of an Application with +placements+, through the same operations. */
  function onboardApplicationRevision(publicId: string, placements: ReturnType<typeof request>[]) {
    const { startApplicationDraft, saveApplicationDraft, confirmRendering, submitApplication, readApplicationDraft } = applications;
    const draft = startApplicationDraft(db, publicId, ana);
    const saved = saveApplicationDraft(db, publicId, { lockVersion: draft.lockVersion, document: { ...readApplicationDraft(draft), placements } });
    const confirmed = confirmRendering(db, publicId, { lockVersion: saved.lockVersion, candidate: null, actor: ana });
    const result = submitApplication(db, publicId, { lockVersion: confirmed.lockVersion, actor: ana });
    if (!result.submitted) throw new BlockedError("Revision wasn't submitted", result.issues);
    return result;
  }
});
