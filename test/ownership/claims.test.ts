import { and, not } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { transitionAssessment } from "@/lib/assessments/transitions";
import { type RepositorySource, listSources } from "@/lib/catalog/source-records";
import type { Db } from "@/lib/db/client";
import { ValidationError } from "@/lib/db/errors";
import { assessments, initiativeTargets, initiatives, jobs, ownershipAssertions } from "@/lib/db/schema";
import { deleteInitiative, listInitiatives, updateInitiative } from "@/lib/initiatives/initiative-records";
import { applicationHistory, assessmentState, claimChoices, claimView, completeClaim, confirmPortalOwner, correctOwnership, locateRepository, repositoryName } from "@/lib/ownership/claims";
import { recordDeConsoleRead, parseDeConsoleExport } from "@/lib/ownership/de-console";
import { portalOwnership, repositoryOwnership } from "@/lib/ownership/read";
import { createApplication, ensurePortal, recordAssertion } from "@/lib/ownership/records";
import { buildInitiative, buildSource } from "../support/builders";
import { createTestDb, rawRun } from "../support/db";
import { seedAssessment } from "../support/scenarios";
import { manifest } from "../support/profiles";

const ana = { providedBy: "ana@example.com" };
const ben = { providedBy: "ben@example.com" };
const consoleLists = (db: Db, applications: object[]) => recordDeConsoleRead(db, parseDeConsoleExport({ format: "de-console-ownership", version: 1, applications }), { trigger: "schedule" });

describe("claims", () => {
  let db: Db;
  let orders: RepositorySource;

  beforeEach(() => {
    db = createTestDb();
    orders = buildSource(db, { name: "orders" });
  });

  const claimed = (source: RepositorySource) => repositoryOwnership(db, [source.id]).get(source.id)!;

  describe("starting from a git URL", () => {
    it("matches a catalog entry by its canonical URL (Known repository)", () => {
      expect(locateRepository(db, "https://GIT.example.com/acme/orders.git/")).toEqual({ source: orders, created: false });
    });

    it("creates an entry named after the repository when none exists", () => {
      const { source, created } = locateRepository(db, "ssh://git@git.example.com:7999/pay/payee-hub.git");

      expect(created).toBe(true);
      expect(source).toMatchObject({ name: "payee-hub", cloneUrl: "ssh://git@git.example.com:7999/pay/payee-hub.git", canonicalUrl: "ssh://git.example.com:7999/pay/payee-hub", gitRef: null });
      expect(repositoryName("file:///srv/git/ledger")).toBe("ledger");
    });

    it("fails a URL with an access token and stores neither (Unsafe URL)", () => {
      expect(() => locateRepository(db, "https://x-token-auth:ghp_secret123@git.example.com/acme/billing.git")).toThrow(ValidationError);

      expect(listSources(db)).toEqual([orders]);
      const everything = JSON.stringify(db.$client.prepare("select * from repository_sources").all());
      expect(everything).not.toContain("ghp_secret123");
      expect(everything).not.toContain("billing");
    });
  });

  describe("asking only for what's unknown", () => {
    it("asks for the application first, then everything about an application no one knows (Unknown application)", () => {
      expect(claimView(db, orders).asks).toEqual({ application: true, team: false, lineOfBusiness: false, portals: false });
      expect(claimView(db, orders, { sealId: "88010" })).toMatchObject({ record: null, newSealId: "88010", asks: { application: false, team: true, lineOfBusiness: true, portals: true } });
    });

    it("asks nothing more for a second repository of a known application (Second repository of a known application)", () => {
      completeClaim(db, orders.publicId, { ...ana, sealId: "88010", team: "Payments Web", lineOfBusiness: "Payments", portals: ["Digital Bank"] });
      const billing = buildSource(db, { name: "billing" });

      const view = claimView(db, billing, { sealId: "88010" });

      expect(view.asks).toEqual({ application: false, team: false, lineOfBusiness: false, portals: false });
      expect(view.known).toBe(false);
      completeClaim(db, billing.publicId, { ...ana, sealId: "88010" });
      expect(claimView(db, billing).known).toBe(true);
      expect(claimed(billing)).toMatchObject({ team: { value: "Payments Web" }, lineOfBusiness: { value: { label: "Payments" } } });
    });

    it("takes a DE Web application's team and portals from the DE Console and asks only for its Line of Business (DE Web application)", () => {
      consoleLists(db, [{ seal_id: "88001", name: "Access Shell", team: "Access Platform", portals: ["Access"] }]);

      const view = claimView(db, orders, { sealId: "88001" });

      expect(view.deWeb).toBe(true);
      expect(view.asks).toEqual({ application: false, team: false, lineOfBusiness: true, portals: false });
      completeClaim(db, orders.publicId, { ...ana, sealId: "88001", team: "Ignored", portals: ["Ignored"], lineOfBusiness: "Access" });
      expect(claimed(orders)).toMatchObject({ team: { value: "Access Platform", provenance: { source: "de_console" } }, portals: [{ portal: { label: "Access" }, flagged: false }] });
    });

    it("reports every missing answer together and records nothing", () => {
      try {
        completeClaim(db, orders.publicId, { providedBy: " ", sealId: "88010" });
        expect.unreachable();
      } catch (error) {
        expect((error as ValidationError).issues.map((issue) => issue.field)).toEqual(["providedBy", "team", "lineOfBusiness", "portals"]);
      }
      expect(() => completeClaim(db, orders.publicId, { ...ana, sealId: "88 010" })).toThrow(/letters, digits/);
      expect(db.select().from(ownershipAssertions).all()).toEqual([]);
    });

    it("offers only approved portals and Lines of Business, and keeps a new value pending (New portal value)", () => {
      rawRun(db, "update portals set concept_key = 'portal/access' where id = ?", ensurePortal(db, "Access").id);
      completeClaim(db, orders.publicId, { ...ana, sealId: "88010", team: "Payments Web", lineOfBusiness: "Payments", portals: ["JPM Access"] });

      expect(claimChoices(db)).toMatchObject({ portals: [{ label: "Access", conceptKey: "portal/access" }], linesOfBusiness: [] });
      expect(claimed(orders).portals).toMatchObject([{ portal: { label: "JPM Access", conceptKey: null } }]);
    });
  });

  describe("attribution and history", () => {
    it("records who entered a value and whom it's credited to (Value entered for someone else)", () => {
      completeClaim(db, orders.publicId, { providedBy: "ana@example.com", attributedTo: "ben@example.com", sealId: "88010", team: "Payments Web", lineOfBusiness: "Payments", portals: ["Digital Bank"] });

      const team = db.select().from(ownershipAssertions).all().find((assertion) => assertion.attribute === "team")!;
      expect(team).toMatchObject({ providedBy: "ana@example.com", attributedTo: "ben@example.com", source: "person", verification: "unverified" });
      expect(claimed(orders).team.provenance).toMatchObject({ providedBy: "ana@example.com", attributedTo: "ben@example.com" });
    });

    it("drops an attribution to the person who entered it", () => {
      completeClaim(db, orders.publicId, { providedBy: "Ana", attributedTo: " ana ", sealId: "88010", team: "Payments Web", lineOfBusiness: "Payments", portals: ["Digital Bank"] });
      expect(db.select().from(ownershipAssertions).all().every((assertion) => assertion.attributedTo === null)).toBe(true);
    });

    it("supersedes the old team on a correction and keeps both in its history (Correction keeps history)", () => {
      completeClaim(db, orders.publicId, { ...ana, sealId: "88010", team: "Payments Web", lineOfBusiness: "Payments", portals: ["Digital Bank"] });

      const result = correctOwnership(db, orders.publicId, { ...ben, sealId: "88010", team: "Payments Experience", lineOfBusiness: "Payments", portals: ["Digital Bank"] });

      expect(result).toEqual({ recorded: 1, sealChanged: false });
      expect(claimed(orders).team).toMatchObject({ value: "Payments Experience", conflict: false, provenance: { providedBy: "ben@example.com" } });
      const history = applicationHistory(db, claimed(orders).application.value!.id, "team");
      expect(history.map((entry) => [entry.assertion.valueTeam, entry.provenance.providedBy, entry.supersededBy.length])).toEqual([
        ["Payments Web", "ana@example.com", 1],
        ["Payments Experience", "ben@example.com", 0],
      ]);
      expect(history[0]!.supersededBy).toEqual([history[1]!.assertion.publicId]);
    });

    it("settles a conflict when the effective value is resubmitted, and refuses a correction that changes nothing", () => {
      completeClaim(db, orders.publicId, { ...ana, sealId: "88010", team: "Payments Web", lineOfBusiness: "Payments", portals: ["Digital Bank"] });
      expect(() => correctOwnership(db, orders.publicId, { ...ben, sealId: "88010", team: "Payments Web", lineOfBusiness: "payments", portals: ["digital bank"] })).toThrow(/Nothing changed/);
      const application = claimed(orders).application.value!;
      recordAssertion(db, { attribute: "team", application: application.id, team: "Cards", source: "person", providedBy: "ben@example.com" });
      expect(claimed(orders).team).toMatchObject({ value: "Cards", conflict: true });

      correctOwnership(db, orders.publicId, { providedBy: "cy@example.com", sealId: "88010", team: "Cards", lineOfBusiness: "Payments", portals: ["Digital Bank"] });

      expect(claimed(orders).team).toMatchObject({ value: "Cards", conflict: false, provenance: { providedBy: "cy@example.com" } });
      expect(applicationHistory(db, application.id, "team").map((entry) => [entry.assertion.valueTeam, entry.supersededBy.length])).toEqual([
        ["Payments Web", 1],
        ["Cards", 1],
        ["Cards", 0],
      ]);
    });

    it("adds and removes portals as corrections", () => {
      completeClaim(db, orders.publicId, { ...ana, sealId: "88010", team: "Payments Web", lineOfBusiness: "Payments", portals: ["Digital Bank", "Access"] });

      correctOwnership(db, orders.publicId, { ...ben, sealId: "88010", team: "Payments Web", lineOfBusiness: "Payments", portals: ["Digital Bank", "Markets"] });

      expect(claimed(orders).portals.map((item) => item.portal.label).sort()).toEqual(["Digital Bank", "Markets"]);
    });

    it("records a new SEAL ID alone, so the new application's values are asked for", () => {
      completeClaim(db, orders.publicId, { ...ana, sealId: "88010", team: "Payments Web", lineOfBusiness: "Payments", portals: ["Digital Bank"] });

      expect(correctOwnership(db, orders.publicId, { ...ben, sealId: "88020", team: "Other" })).toEqual({ recorded: 1, sealChanged: true });
      expect(claimed(orders).application).toMatchObject({ value: { sealId: "88020" }, conflict: false });
      expect(claimView(db, orders).asks).toEqual({ application: false, team: true, lineOfBusiness: true, portals: true });
    });

    it("moves a repository only to the application chosen among those sharing a SEAL ID", () => {
      completeClaim(db, orders.publicId, { ...ana, sealId: "88010", team: "Payments Web", lineOfBusiness: "Payments", portals: ["Digital Bank"] });
      const first = createApplication(db, { sealId: "88030", name: "Ledger" });
      const second = createApplication(db, { sealId: "88030", name: "Ledger reporting" });

      expect(() => correctOwnership(db, orders.publicId, { ...ben, sealId: "88030" })).toThrow(/2 applications carry SEAL ID 88030/);
      expect(correctOwnership(db, orders.publicId, { ...ben, sealId: "88030", application: second.publicId })).toEqual({ recorded: 1, sealChanged: true });
      expect(claimed(orders).application).toMatchObject({ value: { publicId: second.publicId }, conflict: false });

      correctOwnership(db, orders.publicId, { ...ben, sealId: "88030", newApplication: true });
      const moved = claimed(orders).application.value!;
      expect([first.publicId, second.publicId]).not.toContain(moved.publicId);
      expect(moved).toMatchObject({ sealId: "88030", name: null });
      expect(db.$client.prepare("select count(*) as n from applications where seal_id = '88030'").get()).toEqual({ n: 3 });
    });
  });

  describe("applications that share a SEAL ID", () => {
    it("asks which application a shared SEAL ID means, and merges nothing (Applications share one SEAL ID)", () => {
      const payments = createApplication(db, { sealId: "88010", name: "Payments workspace" });
      const reporting = createApplication(db, { sealId: "88010", name: "Payments reporting" });
      recordAssertion(db, { attribute: "team", application: reporting.id, team: "Payments Insights", source: "person", providedBy: "cy@example.com" });

      const view = claimView(db, orders, { sealId: "88010" });
      expect(view).toMatchObject({ record: null, newSealId: null, sealId: "88010", asks: { application: true } });
      expect(view.sameSeal.map((application) => application.publicId)).toEqual([payments.publicId, reporting.publicId]);
      expect(() => completeClaim(db, orders.publicId, { ...ana, sealId: "88010" })).toThrow(/2 applications carry SEAL ID 88010/);

      completeClaim(db, orders.publicId, { ...ana, application: reporting.publicId, lineOfBusiness: "Payments", portals: ["Digital Bank"] });
      expect(claimed(orders)).toMatchObject({ application: { value: { publicId: reporting.publicId } }, team: { value: "Payments Insights" } });
      expect(applicationHistory(db, payments.id, "team")).toEqual([]);
      expect(db.$client.prepare("select count(*) as n from applications").get()).toEqual({ n: 2 });
    });

    it("proposes the one application a SEAL ID names, but lets the claimant choose it or a new one", () => {
      const payments = createApplication(db, { sealId: "88010", name: "Payments workspace" });

      expect(claimView(db, orders, { sealId: "88010" }).record?.publicId).toBe(payments.publicId);
      expect(claimView(db, orders, { sealId: "88010", choose: true })).toMatchObject({ record: null, asks: { application: true } });
      expect(claimView(db, orders, { sealId: "88010", choose: true }).sameSeal).toHaveLength(1);

      completeClaim(db, orders.publicId, { ...ana, sealId: "88010", newApplication: true, team: "Orders", lineOfBusiness: "Payments", portals: ["Digital Bank"] });
      const linked = claimed(orders).application.value!;
      expect(linked.publicId).not.toBe(payments.publicId);
      expect(linked).toMatchObject({ sealId: "88010" });
      expect(linked.publicId).toMatch(/^wap_/);
    });

    it("never resolves an unknown application ID to another application", () => {
      createApplication(db, { sealId: "88010", name: "Payments workspace" });
      expect(claimView(db, orders, { application: "wap_aaaaaaaaaaaaaaaa", sealId: "88010" })).toMatchObject({ record: null, asks: { application: true } });
      expect(() => completeClaim(db, orders.publicId, { ...ana, application: "wap_aaaaaaaaaaaaaaaa" })).toThrow(/Choose an application/);
    });
  });

  describe("portal hosts", () => {
    const fullClaim = { sealId: "88001", team: "Access Platform", lineOfBusiness: "Access", portals: ["Access"] };

    it("records the host and proposes its application as owner of an unowned portal (Host claimed for an unowned portal)", () => {
      const { ownerProposal } = completeClaim(db, orders.publicId, { ...ana, ...fullClaim, hosts: "Access" });

      expect(ownerProposal?.label).toBe("Access");
      expect(portalOwnership(db, [ownerProposal!.id]).get(ownerProposal!.id)).toMatchObject({ host: { value: { name: "orders" } }, owner: { value: null } });
      confirmPortalOwner(db, orders.publicId, ownerProposal!.publicId, ana);
      expect(portalOwnership(db, [ownerProposal!.id]).get(ownerProposal!.id)).toMatchObject({ owner: { value: { sealId: "88001" } }, lineOfBusiness: { value: { label: "Access" } } });
      expect(() => confirmPortalOwner(db, orders.publicId, ownerProposal!.publicId, ana)).toThrow(/already owned by 88001/);
    });

    it("puts the host in conflict when a second repository claims it, keeping both (Second host)", () => {
      completeClaim(db, orders.publicId, { ...ana, ...fullClaim, hosts: "Access" });
      const shell = buildSource(db, { name: "access-shell" });

      const { ownerProposal } = completeClaim(db, shell.publicId, { ...ben, sealId: "88001", hosts: "access" });

      expect(ownerProposal?.label).toBe("Access");
      const host = portalOwnership(db, [ownerProposal!.id]).get(ownerProposal!.id)!.host;
      expect(host.conflict).toBe(true);
      expect(host.candidates.map((candidate) => candidate.value.name).sort()).toEqual(["access-shell", "orders"]);
    });

    it("proposes no owner for a portal that has one, and refuses a repository that isn't its host", () => {
      completeClaim(db, orders.publicId, { ...ana, ...fullClaim, hosts: "Access" });
      const access = ensurePortal(db, "Access");
      confirmPortalOwner(db, orders.publicId, access.publicId, ana);
      const shell = buildSource(db, { name: "access-shell" });

      expect(completeClaim(db, shell.publicId, { ...ben, sealId: "88001", hosts: "Access" }).ownerProposal).toBeNull();
      const ledger = buildSource(db, { name: "ledger" });
      completeClaim(db, ledger.publicId, { ...ben, sealId: "88001" });
      expect(() => confirmPortalOwner(db, ledger.publicId, ensurePortal(db, "Markets").publicId, ben)).toThrow(/isn't claimed as the portal's host/);
    });
  });

  describe("the claim's Run", () => {
    const fullClaim = { sealId: "88010", team: "Payments Web", lineOfBusiness: "Payments", portals: ["Digital Bank"] };

    it("creates the repository's system-owned initiative and starts a Run of its default branch (First claim)", () => {
      const { started } = completeClaim(db, orders.publicId, { ...ana, ...fullClaim, launchToken: "4a6e3b0c-6a43-4e0f-9a59-9a2d0f2a8e11" });

      // Besides the Salt Patterns and Repository profiling initiatives the migrations seed.
      const created = db.select().from(initiatives).where(and(not(initiatives.systemOwned), not(initiatives.profiling))).all();
      expect(created).toHaveLength(1);
      expect(created[0]).toMatchObject({ claimRepositorySourceId: orders.id, selectionMode: "explicit", name: "Claim: orders" });
      expect(db.select().from(initiativeTargets).all().map((target) => target.repositorySourceId)).toEqual([orders.id]);
      expect(started).toMatchObject({ initiativeId: created[0]!.id, state: "queued" });
      expect(db.$client.prepare("select git_ref from assessment_targets").all()).toEqual([{ git_ref: null }]);
      expect(db.select().from(jobs).all().map((job) => job.kind)).toEqual(["assessment.coordinate"]);
      expect(assessmentState(db, orders.id)).toMatchObject({ profile: null, active: { id: started!.id } });
    });

    it("assesses the default branch even when the catalog entry names another reference", () => {
      const pinned = buildSource(db, { name: "pinned", gitRef: "release" });

      completeClaim(db, pinned.publicId, { ...ana, ...fullClaim });

      expect(db.$client.prepare("select source_name, git_ref from assessment_targets").all()).toEqual([{ source_name: "pinned", git_ref: null }]);
    });

    it("starts no second Run while one is in progress, and reuses the initiative later (Initiative reused)", () => {
      const first = completeClaim(db, orders.publicId, { ...ana, ...fullClaim }).started!;
      expect(completeClaim(db, orders.publicId, { ...ben }).started).toBeNull();

      transitionAssessment(db, first, "failed", { failureReason: "Acquisition failed" });
      const second = completeClaim(db, orders.publicId, { ...ben }).started!;

      expect(second.id).not.toBe(first.id);
      expect(second.initiativeId).toBe(first.initiativeId);
      expect(db.select().from(initiatives).where(and(not(initiatives.systemOwned), not(initiatives.profiling))).all()).toHaveLength(1);
    });

    it("starts no Run for a repository with a complete one", async () => {
      await seedAssessment(db, buildInitiative(db, { sources: [orders] }), [orders], [{ "package.json": manifest({ name: "orders", version: "1.0.0" }) }]);

      expect(completeClaim(db, orders.publicId, { ...ana, ...fullClaim }).started).toBeNull();
      expect(assessmentState(db, orders.id).profile).not.toBeNull();
      expect(db.select().from(assessments).all()).toHaveLength(1);
    });

    it("lists system-owned initiatives apart, and keeps their scope and existence", () => {
      const operator = buildInitiative(db, { name: "Fleet assessment" });
      completeClaim(db, orders.publicId, { ...ana, ...fullClaim });
      const [system] = listInitiatives(db, { systemOwned: true });

      expect(listInitiatives(db).map((initiative) => initiative.name)).toEqual(["Fleet assessment"]);
      expect(system?.name).toBe("Claim: orders");
      expect(operator.claimRepositorySourceId).toBeNull();
      const other = buildSource(db, { name: "billing" });
      expect(() => updateInitiative(db, system!.publicId, system!.lockVersion, { name: "Claim: orders", selectionMode: "explicit", sourcePublicIds: [other.publicId] })).toThrow(/scope can't change/);
      expect(updateInitiative(db, system!.publicId, system!.lockVersion, { name: "Orders claim", selectionMode: "explicit", sourcePublicIds: [orders.publicId] }).name).toBe("Orders claim");
      expect(() => deleteInitiative(db, system!.publicId)).toThrow(/retained/);
      expect(() => rawRun(db, "delete from initiatives where id = ?", system!.id)).toThrow(/retained/);
      expect(() => rawRun(db, "insert into initiative_targets (initiative_id, repository_source_id, created_at) values (?, ?, 0)", system!.id, other.id)).toThrow(/only its own repository/);
      expect(() => rawRun(db, "update initiatives set selection_mode = 'all' where id = ?", system!.id)).toThrow(/keeps its one repository/);
    });
  });
});
