import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { applications, portals } from "@/lib/db/schema";
import { claimedShare, fleetSummary } from "@/lib/home/summary";
import { claimInitiative } from "@/lib/initiatives/initiative-records";
import { createApplication, ensurePortal } from "@/lib/ownership/records";
import { buildAssessment, buildInitiative, buildSource } from "../support/builders";
import { createTestDb } from "../support/db";
import { buildEvaluation, claim, driveEvaluation, driveRun } from "../support/home";
import { registerApplication } from "../support/applications";
import { onboardPortal } from "../support/onboarding";

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

  it("shows figures, not an empty state, when Portals exist but none is in Production and no Application exists (Records exist but none are active)", () => {
    const db = createTestDb();
    onboardPortal(db, "Access");
    onboardPortal(db, "Markets");

    expect(fleetSummary(db).applications).toEqual({ empty: false, applications: 0, undetermined: 0, productionPortals: 0 });
  });

  it("counts registered Applications, those with an Undetermined rendering, and Portals in Production, leaving claims out", () => {
    const db = createTestDb();
    const access = onboardPortal(db, "Access");
    const markets = onboardPortal(db, "Markets");
    ensurePortal(db, "Lending");
    db.update(portals).set({ lifecycle: "production" }).where(eq(portals.id, access.id)).run();
    registerApplication(db, { name: "Payee Hub", portal: access });
    const ledger = registerApplication(db, { name: "Ledger", portal: markets });
    createApplication(db, { sealId: "88001" });
    const assessment = buildAssessment(db, { sources: [buildSource(db)] }).assessment;
    db.update(applications).set({ renderingMode: "undetermined", renderingEvidence: "{}", renderingAssessmentId: assessment.id }).where(eq(applications.id, ledger.id)).run();

    expect(fleetSummary(db).applications).toEqual({ empty: false, applications: 2, undetermined: 1, productionPortals: 1 });
  });

  it("stays empty while the only Portals are named in claims", () => {
    const db = createTestDb();
    ensurePortal(db, "Lending");
    expect(fleetSummary(db).applications.empty).toBe(true);
  });

  it("reports every group empty in a fresh installation (Fresh installation)", () => {
    const db = createTestDb();
    const summary = fleetSummary(db);
    expect(summary.repositories.empty).toBe(true);
    expect(summary.assessments.empty).toBe(true);
    expect(summary.applications.empty).toBe(true);
  });

  it("doesn't count only claim-created Assessments as the operator's", () => {
    const db = createTestDb();
    claimInitiative(db, buildSource(db));
    expect(fleetSummary(db).assessments).toMatchObject({ empty: true, total: 0 });
  });
});
