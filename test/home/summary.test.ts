import { describe, expect, it } from "vitest";
import { portals } from "@/lib/db/schema";
import { claimedShare, fleetSummary } from "@/lib/home/summary";
import { claimInitiative } from "@/lib/initiatives/initiative-records";
import { ensurePortal } from "@/lib/ownership/records";
import { buildAssessment, buildInitiative, buildSource } from "../support/builders";
import { createTestDb } from "../support/db";
import { buildEvaluation, claim, driveEvaluation, driveRun } from "../support/home";
import { decide, onboardApplication, onboardPortal, placementsOf } from "../support/onboarding";

describe("fleet summary", () => {
  it("counts enabled, claimed, and unclaimed Repositories, leaving disabled claims out (Ownership coverage)", () => {
    const db = createTestDb();
    const enabled = Array.from({ length: 212 }, () => buildSource(db));
    for (const source of enabled.slice(0, 130)) claim(db, source);
    for (let i = 0; i < 5; i++) claim(db, buildSource(db, { enabled: false }));

    const { repositories } = fleetSummary(db);
    expect(repositories).toMatchObject({ empty: false, enabled: 212, claimed: 130, unclaimed: 82 });
    expect(claimedShare(repositories)).toBe(61);
    expect(claimedShare({ enabled: 0, claimed: 0 })).toBeNull();
  });

  it("counts the operator's Assessments by conclusion and hides Not applicable at zero (Not applicable hidden at zero)", () => {
    const db = createTestDb();
    const source = buildSource(db);
    const evaluated = (conclusion: "gaps" | "conforms") => {
      const initiative = buildInitiative(db, { sources: [source] });
      driveEvaluation(db, buildEvaluation(db, initiative, driveRun(db, buildAssessment(db, { initiative }).assessment, "complete")), "complete", conclusion);
    };
    evaluated("gaps");
    evaluated("gaps");
    evaluated("conforms");
    buildInitiative(db, { sources: [source] });
    claimInitiative(db, source);

    const { assessments } = fleetSummary(db);
    expect(assessments).toEqual({ empty: false, total: 4, byConclusion: { gaps: 2, undetermined: 0, conforms: 1, not_applicable: 0, none: 1 } });
  });

  it("shows figures, not an empty state, when records exist but none are active (Records exist but none are active)", () => {
    const db = createTestDb();
    ensurePortal(db, "Access");
    ensurePortal(db, "Markets");
    db.update(portals).set({ lifecycle: "draft" }).run();

    expect(fleetSummary(db).onboarding).toEqual({ empty: false, activePortals: 0, placedApplications: 0 });
  });

  it("counts active Portals, and Web Applications a Portal has placed", () => {
    const db = createTestDb();
    const access = onboardPortal(db, "Access");
    // Activating a Portal needs approved default routes; the lifecycle alone is what Active Portals counts.
    db.update(portals).set({ lifecycle: "active" }).run();
    const request = { placement: null, portal: access.publicId, menuParent: null, route: "/payments", label: "Payments", order: 1, environments: ["prod"], entitlements: { codes: [], operator: "any" as const }, defaultRequested: false };
    const placed = onboardApplication(db, "Payments workspace", { launch: { kind: "external", mode: "iframe", documentUrl: "https://payments.example.com/app" }, placements: [request] }).application;
    onboardApplication(db, "Payments reporting", { launch: { kind: "external", mode: "iframe", documentUrl: "https://payments.example.com/reports" }, placements: [{ ...request, route: "/reports", label: "Reports" }] });
    expect(fleetSummary(db).onboarding).toMatchObject({ activePortals: 1, placedApplications: 0 });

    decide(db, placementsOf(db, placed.publicId)[0]!, "approve");
    expect(fleetSummary(db).onboarding).toEqual({ empty: false, activePortals: 1, placedApplications: 1 });
  });

  it("reports every group empty in a fresh installation (Fresh installation)", () => {
    const db = createTestDb();
    const summary = fleetSummary(db);
    expect(summary.repositories.empty).toBe(true);
    expect(summary.assessments.empty).toBe(true);
    expect(summary.onboarding.empty).toBe(true);
  });

  it("doesn't count only claim-created Assessments as the operator's", () => {
    const db = createTestDb();
    claimInitiative(db, buildSource(db));
    expect(fleetSummary(db).assessments).toMatchObject({ empty: true, total: 0 });
  });
});
