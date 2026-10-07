import { beforeEach, describe, expect, it } from "vitest";
import type { RepositorySource } from "@/lib/catalog/source-records";
import type { Db } from "@/lib/db/client";
import { applicationOwnership, ownershipForAssessment, portalOwnership, repositoryOwnership } from "@/lib/ownership/read";
import { type Application, applicationsWithSealId, createApplication, ensureLineOfBusiness, ensurePortal, labelKey, recordAssertion } from "@/lib/ownership/records";
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
  let markets: Application;

  beforeEach(() => {
    db = createTestDb();
    web = buildSource(db, { name: "fx-board" });
    markets = createApplication(db, { sealId: "SEAL-1001", name: "FX Board" });
  });

  it("names one application per repository, or reports every candidate (One application per repository)", () => {
    recordAssertion(db, { attribute: "application", repository: web.id, application: markets.id, ...person("ana", 1) });
    expect(repositoryOwnership(db, [web.id]).get(web.id)!.application).toMatchObject({ value: { sealId: "SEAL-1001" }, conflict: false });

    const other = createApplication(db, { sealId: "SEAL-2002" });
    recordAssertion(db, { attribute: "application", repository: web.id, application: other.id, ...person("ben", 2) });
    const application = repositoryOwnership(db, [web.id]).get(web.id)!.application;

    expect(application.conflict).toBe(true);
    expect(application.value?.sealId).toBe("SEAL-2002");
    expect(application.candidates.map((candidate) => [candidate.value.sealId, candidate.provenance.providedBy])).toEqual([
      ["SEAL-2002", "ben"],
      ["SEAL-1001", "ana"],
    ]);
  });

  it("takes a repository's Line of Business from its application, and a portal's from its owner (Application in a portal owned by another Line of Business)", () => {
    const payments = createApplication(db, { sealId: "SEAL-3003", name: "Access shell" });
    const access = ensurePortal(db, "Access");
    recordAssertion(db, { attribute: "application", repository: web.id, application: markets.id, ...person("ana", 1) });
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
    recordAssertion(db, { attribute: "application", repository: web.id, application: markets.id, ...person("ana", 30) });
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
  });

  it("keeps applications that share a SEAL ID apart: each has its own repositories, team, and history (Applications share one SEAL ID)", () => {
    const reporting = createApplication(db, { sealId: " SEAL-1001 ", name: "FX reporting" });
    const api = buildSource(db, { name: "fx-reporting" });
    recordAssertion(db, { attribute: "application", repository: web.id, application: markets.id, ...person("ana", 1) });
    recordAssertion(db, { attribute: "application", repository: api.id, application: reporting.id, ...person("ben", 2) });
    recordAssertion(db, { attribute: "team", application: markets.id, team: "FX Platform", ...person("ana", 3) });
    recordAssertion(db, { attribute: "team", application: reporting.id, team: "FX Reporting", ...person("ben", 4) });

    expect(reporting).toMatchObject({ sealId: "SEAL-1001" });
    expect(reporting.id).not.toBe(markets.id);
    expect(applicationsWithSealId(db, "SEAL-1001").map((application) => application.publicId)).toEqual([markets.publicId, reporting.publicId]);
    const owned = repositoryOwnership(db, [web.id, api.id]);
    expect(owned.get(web.id)).toMatchObject({ application: { value: { publicId: markets.publicId }, conflict: false }, team: { value: "FX Platform", conflict: false } });
    expect(owned.get(api.id)).toMatchObject({ application: { value: { publicId: reporting.publicId }, conflict: false }, team: { value: "FX Reporting", conflict: false } });
    expect(db.$client.prepare("select count(*) as n from applications").get()).toEqual({ n: 2 });
  });
});

describe("ownership records in the database", () => {
  let db: Db;
  let markets: Application;

  beforeEach(() => {
    db = createTestDb();
    markets = createApplication(db, { sealId: "SEAL-1001" });
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
    const other = createApplication(db, { sealId: "SEAL-2002" });

    expect(() => recordAssertion(db, { attribute: "team", application: other.id, team: "Rates UI", ...person("ana", 2), supersedes: [team.id] })).toThrow(/same subject and attribute/);
    expect(() => recordAssertion(db, { attribute: "line_of_business", application: markets.id, lineOfBusiness: ensureLineOfBusiness(db, "Markets").id, ...person("ana", 2), supersedes: [team.id] })).toThrow(/same subject and attribute/);
    expect((db.$client.prepare("select count(*) as n from ownership_assertions").get() as { n: number }).n).toBe(1);
  });

  it("refuses an assertion whose subject or value doesn't fit its attribute, or a DE Console import without a read time", () => {
    expect(() => rawRun(db, "insert into ownership_assertions (public_id, attribute, operation, subject_application_id, value_team, provided_by, source, verification, recorded_at) values ('own_aaaaaaaaaaaaaaaa', 'team', 'add', ?, 'FX', 'ana', 'person', 'unverified', 1)", markets.id)).toThrow(/CHECK constraint failed/);
    expect(() => rawRun(db, "insert into ownership_assertions (public_id, attribute, operation, subject_application_id, value_team, provided_by, source, verification, recorded_at) values ('own_aaaaaaaaaaaaaaab', 'team', 'set', ?, 'FX', 'DE Console', 'de_console', 'not_required', 1)", markets.id)).toThrow(/CHECK constraint failed/);
  });

  it("gives each application its own identity: SEAL IDs repeat, and malformed identifiers are refused", () => {
    rawRun(db, "insert into applications (public_id, seal_id, name, created_at) values ('wap_aaaaaaaaaaaaaaaa', 'SEAL-1001', 'FX Board reporting', 1)");
    rawRun(db, "insert into applications (public_id, seal_id, name, created_at) values ('wap_aaaaaaaaaaaaaaab', 'SEAL-1001', NULL, 1)");
    expect(db.$client.prepare("select count(*) as n from applications where seal_id = 'SEAL-1001'").get()).toEqual({ n: 3 });

    expect(markets.publicId).toMatch(/^wap_[a-z0-9]{16}$/);
    expect(() => rawRun(db, "insert into applications (public_id, seal_id, created_at) values ('app_aaaaaaaaaaaaaaaa', 'SEAL-1', 1)")).toThrow(/applications_public_id/);
    expect(() => rawRun(db, "insert into applications (public_id, seal_id, created_at) values ('wap_aaaaaaaaaaaaaaaa', 'SEAL-1', 1)")).toThrow(/UNIQUE constraint failed: applications.public_id/);
    expect(() => rawRun(db, "insert into applications (public_id, seal_id, created_at) values ('wap_aaaaaaaaaaaaaaac', ' SEAL-1', 1)")).toThrow(/applications_seal_id/);
    expect(() => rawRun(db, "insert into applications (public_id, seal_id, created_at) values ('wap_aaaaaaaaaaaaaaad', '', 1)")).toThrow(/applications_seal_id/);
    expect(() => rawRun(db, "insert into applications (public_id, seal_id, name, created_at) values ('wap_aaaaaaaaaaaaaaae', 'SEAL-1', '  ', 1)")).toThrow(/applications_name/);
  });

  it("links a repository to an application row, never to a SEAL ID string", () => {
    const web = buildSource(db, { name: "fx-board" });
    const insert = (attribute: string, subject: string, value: string) =>
      rawRun(db, `insert into ownership_assertions (public_id, attribute, operation, ${subject}, ${value}, provided_by, source, verification, recorded_at) values ('own_aaaaaaaaaaaaaaac', '${attribute}', 'set', ?, ?, 'ana', 'person', 'unverified', 1)`, web.id, markets.id);

    expect(() => insert("seal_id", "subject_repository_source_id", "value_application_id")).toThrow(/ownership_assertions_attribute/);
    expect(() => rawRun(db, "insert into ownership_assertions (public_id, attribute, operation, subject_application_id, value_application_id, provided_by, source, verification, recorded_at) values ('own_aaaaaaaaaaaaaaac', 'application', 'set', ?, ?, 'ana', 'person', 'unverified', 1)", markets.id, markets.id)).toThrow(/ownership_assertions_shape/);
    expect(() => rawRun(db, "insert into ownership_assertions (public_id, attribute, operation, subject_repository_source_id, value_team, provided_by, source, verification, recorded_at) values ('own_aaaaaaaaaaaaaaac', 'application', 'set', ?, 'SEAL-1001', 'ana', 'person', 'unverified', 1)", web.id)).toThrow(/ownership_assertions_shape/);
    expect(() => rawRun(db, "insert into ownership_assertions (public_id, attribute, operation, subject_repository_source_id, value_application_id, provided_by, source, verification, recorded_at) values ('own_aaaaaaaaaaaaaaac', 'application', 'set', ?, 999, 'ana', 'person', 'unverified', 1)", web.id)).toThrow(/FOREIGN KEY/);
    insert("application", "subject_repository_source_id", "value_application_id");
    expect(db.$client.prepare("select attribute, value_application_id as application from ownership_assertions").get()).toEqual({ attribute: "application", application: markets.id });
  });

  it("keeps application identity while allowing SEAL metadata corrections, and keeps an approved portal concept", () => {
    const access = ensurePortal(db, "Access");
    rawRun(db, "update portals set concept_key = 'portal/access' where id = ?", access.id);

    expect(() => rawRun(db, "update portals set concept_key = 'portal/markets' where id = ?", access.id)).toThrow(/keeps its identity/);
    rawRun(db, "update applications set seal_id = 'SEAL-9' where id = ?", markets.id);
    expect(db.$client.prepare("select public_id as publicId, seal_id as sealId from applications where id = ?").get(markets.id)).toEqual({ publicId: markets.publicId, sealId: "SEAL-9" });
    expect(() => rawRun(db, "delete from applications")).toThrow(/retained/);
    expect(() => rawRun(db, "delete from portals")).toThrow(/retained/);
  });
});
