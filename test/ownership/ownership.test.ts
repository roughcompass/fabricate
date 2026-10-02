import { beforeEach, describe, expect, it } from "vitest";
import type { RepositorySource } from "@/lib/catalog/source-records";
import type { Db } from "@/lib/db/client";
import { applicationOwnership, ownershipForAssessment, portalOwnership, repositoryOwnership } from "@/lib/ownership/read";
import { type SealApplication, ensureApplication, ensureLineOfBusiness, ensurePortal, labelKey, recordAssertion } from "@/lib/ownership/records";
import { buildInitiative, buildSource } from "../support/builders";
import { createTestDb, rawRun } from "../support/db";
import { seedAssessment } from "../support/scenarios";
import { manifest } from "../support/profiles";

const at = (minute: number) => new Date(Date.UTC(2026, 9, 1, 9, minute));
const person = (name: string, minute: number, verified = false) => ({ source: "person" as const, providedBy: name, recordedAt: at(minute), verifiedAt: verified ? at(minute) : null });
const deConsole = (minute: number) => ({ source: "de_console" as const, providedBy: "DE Console", readAt: at(minute), recordedAt: at(minute) });

describe("ownership", () => {
  let db: Db;
  let web: RepositorySource;
  let markets: SealApplication;

  beforeEach(() => {
    db = createTestDb();
    web = buildSource(db, { name: "fx-board" });
    markets = ensureApplication(db, "SEAL-1001", "FX Board");
  });

  it("names one SEAL application per repository, or reports every candidate (One SEAL application per repository)", () => {
    recordAssertion(db, { attribute: "seal_id", repository: web.id, application: markets.id, ...person("ana", 1) });
    expect(repositoryOwnership(db, [web.id]).get(web.id)!.application).toMatchObject({ value: { sealId: "SEAL-1001" }, conflict: false });

    const other = ensureApplication(db, "SEAL-2002");
    recordAssertion(db, { attribute: "seal_id", repository: web.id, application: other.id, ...person("ben", 2) });
    const application = repositoryOwnership(db, [web.id]).get(web.id)!.application;

    expect(application.conflict).toBe(true);
    expect(application.value?.sealId).toBe("SEAL-2002");
    expect(application.candidates.map((candidate) => [candidate.value.sealId, candidate.provenance.providedBy])).toEqual([
      ["SEAL-2002", "ben"],
      ["SEAL-1001", "ana"],
    ]);
  });

  it("takes a repository's Line of Business from its application, and a portal's from its owner (Application in a portal owned by another Line of Business)", () => {
    const payments = ensureApplication(db, "SEAL-3003", "Access shell");
    const access = ensurePortal(db, "Access");
    recordAssertion(db, { attribute: "seal_id", repository: web.id, application: markets.id, ...person("ana", 1) });
    recordAssertion(db, { attribute: "line_of_business", application: markets.id, lineOfBusiness: ensureLineOfBusiness(db, "Markets").id, ...person("ana", 1) });
    recordAssertion(db, { attribute: "line_of_business", application: payments.id, lineOfBusiness: ensureLineOfBusiness(db, "Payments").id, ...person("cy", 1) });
    recordAssertion(db, { attribute: "owner", portal: access.id, application: payments.id, ...person("cy", 2) });
    recordAssertion(db, { attribute: "portal", operation: "add", application: markets.id, portal: access.id, ...person("ana", 3) });

    const repository = repositoryOwnership(db, [web.id]).get(web.id)!;
    expect(repository.lineOfBusiness.value?.label).toBe("Markets");
    expect(repository.portals.map((item) => item.portal.label)).toEqual(["Access"]);
    const portal = portalOwnership(db, [access.id]).get(access.id)!;
    expect(portal.owner.value?.sealId).toBe("SEAL-3003");
    expect(portal.lineOfBusiness.value?.label).toBe("Payments");
  });

  it("keeps a verified team effective against a later unverified one, in conflict (Unverified claim against a verified one)", () => {
    recordAssertion(db, { attribute: "team", application: markets.id, team: "FX Platform", ...person("ana", 1, true) });
    recordAssertion(db, { attribute: "team", application: markets.id, team: "Rates UI", ...person("ben", 5) });

    const team = applicationOwnership(db, [markets.id]).get(markets.id)!.team;
    expect(team).toMatchObject({ value: "FX Platform", conflict: true, provenance: { providedBy: "ana", verification: "verified" } });
    expect(team.candidates.map((candidate) => candidate.value)).toEqual(["FX Platform", "Rates UI"]);
  });

  it("clears a conflict when an assertion supersedes both values, keeping all three in the history (Conflict resolved)", () => {
    const first = recordAssertion(db, { attribute: "team", application: markets.id, team: "FX Platform", ...person("ana", 1) });
    const second = recordAssertion(db, { attribute: "team", application: markets.id, team: "Rates UI", ...person("ben", 2) });
    recordAssertion(db, { attribute: "team", application: markets.id, team: "FX Platform", ...person("cy", 3), supersedes: [first.id, second.id] });

    expect(applicationOwnership(db, [markets.id]).get(markets.id)!.team).toMatchObject({ value: "FX Platform", conflict: false, provenance: { providedBy: "cy" } });
    expect((db.$client.prepare("select count(*) as n from ownership_assertions where attribute = 'team'").get() as { n: number }).n).toBe(3);
  });

  it("lets a person correct their own claim without a conflict", () => {
    recordAssertion(db, { attribute: "team", application: markets.id, team: "FX Platfrom", ...person("ana", 1) });
    recordAssertion(db, { attribute: "team", application: markets.id, team: "FX Platform", ...person("ana", 2) });

    expect(applicationOwnership(db, [markets.id]).get(markets.id)!.team).toMatchObject({ value: "FX Platform", conflict: false });
  });

  it("counts both portals when two people each add one (Two people add different portals)", () => {
    recordAssertion(db, { attribute: "portal", operation: "add", application: markets.id, portal: ensurePortal(db, "Access").id, ...person("ana", 1) });
    recordAssertion(db, { attribute: "portal", operation: "add", application: markets.id, portal: ensurePortal(db, "Markets").id, ...person("ben", 2) });

    const portals = applicationOwnership(db, [markets.id]).get(markets.id)!.portals;
    expect(portals.map((item) => [item.portal.label, item.flagged])).toEqual([
      ["Markets", false],
      ["Access", false],
    ]);
  });

  it("drops a portal once it's removed", () => {
    const access = ensurePortal(db, "Access");
    recordAssertion(db, { attribute: "portal", operation: "add", application: markets.id, portal: access.id, ...person("ana", 1) });
    recordAssertion(db, { attribute: "portal", operation: "remove", application: markets.id, portal: access.id, ...person("ben", 2) });

    expect(applicationOwnership(db, [markets.id]).get(markets.id)!.portals).toEqual([]);
  });

  it("keeps the DE Console's portals and flags another claimed one (Extra portal on a DE Web application)", () => {
    recordAssertion(db, { attribute: "portal", operation: "add", application: markets.id, portal: ensurePortal(db, "Markets").id, ...deConsole(1) });
    recordAssertion(db, { attribute: "team", application: markets.id, team: "FX Platform", ...deConsole(1) });
    recordAssertion(db, { attribute: "portal", operation: "add", application: markets.id, portal: ensurePortal(db, "Access").id, ...person("ana", 2, true) });

    const ownership = applicationOwnership(db, [markets.id]).get(markets.id)!;
    expect(ownership.deWeb).toBe(true);
    expect(ownership.portals.map((item) => [item.portal.label, item.flagged])).toEqual([
      ["Markets", false],
      ["Access", true],
    ]);
  });

  it("prefers the DE Console's value to any claim", () => {
    recordAssertion(db, { attribute: "team", application: markets.id, team: "Rates UI", ...person("ana", 5, true) });
    recordAssertion(db, { attribute: "team", application: markets.id, team: "FX Platform", ...deConsole(1) });

    expect(applicationOwnership(db, [markets.id]).get(markets.id)!.team).toMatchObject({ value: "FX Platform", conflict: true, provenance: { source: "de_console", readAt: at(1) } });
  });

  it("names the portals a repository hosts", () => {
    const access = ensurePortal(db, "Access");
    recordAssertion(db, { attribute: "host", portal: access.id, repository: web.id, ...person("ana", 1) });

    expect(repositoryOwnership(db, [web.id]).get(web.id)!.hosts.map((portal) => portal.label)).toEqual(["Access"]);
    expect(portalOwnership(db, [access.id]).get(access.id)!.host.value?.name).toBe("fx-board");
  });

  it("gives an earlier assessment its repositories' current ownership, dated (Earlier assessment)", async () => {
    const initiative = buildInitiative(db, { sources: [web] });
    const assessment = await seedAssessment(db, initiative, [web], [{ "package.json": manifest({ name: "fx-board", version: "1.0.0" }) }]);
    recordAssertion(db, { attribute: "seal_id", repository: web.id, application: markets.id, ...person("ana", 30) });
    recordAssertion(db, { attribute: "team", application: markets.id, team: "FX Platform", ...person("ana", 31) });

    const { byTarget, asOf } = ownershipForAssessment(db, assessment.id);
    expect([...byTarget.values()].map((ownership) => [ownership.repository.name, ownership.application.value?.sealId, ownership.team.value])).toEqual([["fx-board", "SEAL-1001", "FX Platform"]]);
    expect(asOf).toEqual(at(31));
  });

  it("reports unknown ownership for an unclaimed repository", () => {
    expect(repositoryOwnership(db, [web.id]).get(web.id)).toMatchObject({ application: { value: null, conflict: false }, portals: [], hosts: [], asOf: null });
  });

  it("treats one label written differently as one value", () => {
    expect(labelKey("  JPM   Access ")).toBe("jpm access");
    expect(ensurePortal(db, "JPM  Access").id).toBe(ensurePortal(db, "jpm access").id);
    expect(ensureApplication(db, " SEAL-1001 ").id).toBe(markets.id);
  });
});

describe("ownership records in the database", () => {
  let db: Db;
  let markets: SealApplication;

  beforeEach(() => {
    db = createTestDb();
    markets = ensureApplication(db, "SEAL-1001");
  });

  it("never changes or deletes an assertion or a supersession", () => {
    const first = recordAssertion(db, { attribute: "team", application: markets.id, team: "FX Platform", ...person("ana", 1) });
    recordAssertion(db, { attribute: "team", application: markets.id, team: "Rates UI", ...person("ana", 2), supersedes: [first.id] });

    expect(() => rawRun(db, "update ownership_assertions set value_team = 'x'")).toThrow(/never changed/);
    expect(() => rawRun(db, "delete from ownership_assertions")).toThrow(/retained/);
    expect(() => rawRun(db, "update ownership_supersessions set superseded_id = 2")).toThrow(/never changed/);
    expect(() => rawRun(db, "delete from ownership_supersessions")).toThrow(/retained/);
  });

  it("lets an assertion supersede only an earlier one about the same subject and attribute", () => {
    const team = recordAssertion(db, { attribute: "team", application: markets.id, team: "FX Platform", ...person("ana", 1) });
    const other = ensureApplication(db, "SEAL-2002");

    expect(() => recordAssertion(db, { attribute: "team", application: other.id, team: "Rates UI", ...person("ana", 2), supersedes: [team.id] })).toThrow(/same subject and attribute/);
    expect(() => recordAssertion(db, { attribute: "line_of_business", application: markets.id, lineOfBusiness: ensureLineOfBusiness(db, "Markets").id, ...person("ana", 2), supersedes: [team.id] })).toThrow(/same subject and attribute/);
    expect((db.$client.prepare("select count(*) as n from ownership_assertions").get() as { n: number }).n).toBe(1);
  });

  it("refuses an assertion whose subject or value doesn't fit its attribute, or a DE Console import without a read time", () => {
    expect(() => rawRun(db, "insert into ownership_assertions (public_id, attribute, operation, subject_application_id, value_team, provided_by, source, verification, recorded_at) values ('own_aaaaaaaaaaaaaaaa', 'team', 'add', ?, 'FX', 'ana', 'person', 'unverified', 1)", markets.id)).toThrow(/CHECK constraint failed/);
    expect(() => rawRun(db, "insert into ownership_assertions (public_id, attribute, operation, subject_application_id, value_team, provided_by, source, verification, recorded_at) values ('own_aaaaaaaaaaaaaaab', 'team', 'set', ?, 'FX', 'DE Console', 'de_console', 'not_required', 1)", markets.id)).toThrow(/CHECK constraint failed/);
  });

  it("keeps an application's identity and a portal's concept once approved", () => {
    const access = ensurePortal(db, "Access");
    rawRun(db, "update portals set concept_key = 'portal/access' where id = ?", access.id);

    expect(() => rawRun(db, "update portals set concept_key = 'portal/markets' where id = ?", access.id)).toThrow(/keeps its identity/);
    expect(() => rawRun(db, "update seal_applications set seal_id = 'SEAL-9' where id = ?", markets.id)).toThrow(/keeps its public ID/);
    expect(() => rawRun(db, "delete from portals")).toThrow(/retained/);
  });
});
