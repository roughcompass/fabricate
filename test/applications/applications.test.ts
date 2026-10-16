import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ApplicationInput, ApplicationValidationError, applicationHistory, createApplication, editApplicationDetails, getApplication } from "@/lib/applications/applications";
import { getSource, setSourceEnabled } from "@/lib/catalog/source-records";
import { getConfig, withOverrides } from "@/lib/config";
import type { Db } from "@/lib/db/client";
import { StaleRecordError } from "@/lib/db/errors";
import { UNSTATED_ACTOR, statedActor } from "@/lib/onboarding/attribution";
import type { Portal } from "@/lib/onboarding/portals";
import { ensurePortal } from "@/lib/ownership/records";
import { buildSource } from "../support/builders";
import { createTestDb } from "../support/db";
import { GitFixture } from "../support/git-fixture";
import { ana, cy, onboardPortal } from "../support/onboarding";

/*
 * Creating and editing Applications (make-applications-first-class task
 * 3.4, design decision 6): field rules with their messages, a slug and a
 * repository that belong to one Application each, a disabled Repository
 * re-enabled, attribution, and no request to any network service.
 */

describe("Applications", () => {
  let db: Db;
  let access: Portal;
  const config = withOverrides(getConfig(), { applications: { bitbucketHosts: ["bitbucket.example.com"] } });

  beforeEach(() => {
    db = createTestDb();
    access = onboardPortal(db, "Access");
  });
  afterEach(() => vi.restoreAllMocks());

  const input = (overrides: Partial<ApplicationInput> = {}): ApplicationInput => ({
    sealId: "88001",
    name: "Payee Hub",
    description: "Payees for Access clients",
    repositoryUrl: "https://github.com/acme/payee-hub",
    portal: access.publicId,
    starter: "salt-starter",
    ...overrides,
  });
  const create = (overrides: Partial<ApplicationInput> = {}, actor = ana) => createApplication(db, input(overrides), actor, config);
  const refusal = (overrides: Partial<ApplicationInput>) => {
    try {
      create(overrides);
    } catch (error) {
      if (error instanceof ApplicationValidationError) return error;
      throw error;
    }
    throw new Error("createApplication accepted the input");
  };

  it("records the fields, the derived slug, the starter, and the Portal, and registers the repository (Created from a starter)", () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    const application = create();
    expect(application).toMatchObject({ name: "Payee Hub", sealId: "88001", slug: "payee-hub", description: "Payees for Access clients", starter: "salt-starter", portalId: access.id, verification: "unverified", createdBy: "ana@example.com" });
    const source = db.$client.prepare("select name, clone_url as cloneUrl, canonical_url as canonicalUrl, enabled from repository_sources where id = ?").get(application.repositorySourceId);
    expect(source).toEqual({ name: "payee-hub", cloneUrl: "https://github.com/acme/payee-hub.git", canonicalUrl: "https://github.com/acme/payee-hub", enabled: 1 });
    expect(applicationHistory(db, application.id)).toMatchObject([{ event: "created", actor: "ana@example.com", attribution: "unverified", detail: "Created from salt-starter" }]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("records a creation with no remembered name as Not stated, Unverified (No remembered name)", () => {
    const application = create({ starter: null }, statedActor(UNSTATED_ACTOR));
    expect(application).toMatchObject({ createdBy: "Not stated", verification: "unverified", starter: null });
    expect(applicationHistory(db, application.id)[0]).toMatchObject({ actor: "Not stated", attribution: "unverified", detail: null });
  });

  it.each([
    [{ sealId: "" }, "sealId", "Enter the application's SEAL ID"],
    [{ sealId: "88 01" }, "sealId", "Enter a SEAL ID of letters, digits, dots, dashes, or underscores"],
    [{ name: " " }, "name", "Enter the application's name"],
    [{ name: "x".repeat(101) }, "name", "Use 100 characters or fewer"],
    [{ description: "" }, "description", "Enter a description of the application"],
    [{ description: "x".repeat(501) }, "description", "Use 500 characters or fewer"],
    [{ slug: "2-payee" }, "slug", "Start the slug with a letter"],
    [{ repositoryUrl: "" }, "repositoryUrl", "Enter the repository's URL"],
    [{ repositoryUrl: "https://gitlab.com/acme/payee-hub" }, "repositoryUrl", "Only Bitbucket and GitHub repository URLs are accepted"],
    [{ portal: "" }, "portal", "Choose the Portal the application belongs to"],
    [{ starter: "Not A Slug" }, "starter", "Choose a starter from the catalog"],
  ])("refuses %j at %s with its message, creating nothing (Missing repository)", (overrides, field, message) => {
    expect(refusal(overrides).messagesFor(field)).toEqual([message]);
    expect(db.$client.prepare("select count(*) as n from applications where name is not null").get()).toEqual({ n: 0 });
    expect(db.$client.prepare("select count(*) as n from repository_sources").get()).toEqual({ n: 0 });
  });

  it("refuses a Portal named only in a claim", () => {
    const lending = ensurePortal(db, "Lending");
    expect(refusal({ portal: lending.publicId }).messagesFor("portal")).toEqual(["Choose the Portal the application belongs to"]);
  });

  it("refuses a taken slug, naming and linking the Application that has it (Taken slug)", () => {
    const ledger = create({ name: "Ledger", slug: "payees", repositoryUrl: "https://github.com/acme/ledger" });
    const error = refusal({ slug: "payees" });
    expect(error.messagesFor("slug")).toEqual(["The slug payees belongs to Ledger"]);
    expect(error.issues.find((issue) => issue.field === "slug")?.link).toEqual({ href: `/applications/${ledger.publicId}`, label: "Open Ledger" });
  });

  it("refuses a repository another Application uses, linking to its dashboard, whichever form of its URL is entered (Repository already used)", () => {
    const ledger = create({ name: "Ledger", repositoryUrl: "https://github.com/acme/ledger.git" });
    for (const repositoryUrl of ["https://github.com/acme/ledger", "https://github.com/acme/ledger/"]) {
      const error = refusal({ repositoryUrl });
      expect(error.messagesFor("repositoryUrl")).toEqual(["Ledger already uses this repository"]);
      expect(error.issues.find((issue) => issue.field === "repositoryUrl")?.link).toEqual({ href: `/applications/${ledger.publicId}`, label: "Open Ledger" });
    }
  });

  it("reuses a Repository the registry has, and re-enables a disabled one", () => {
    const registered = buildSource(db, { name: "payee-hub", cloneUrl: "https://github.com/acme/payee-hub.git", canonicalUrl: "https://github.com/acme/payee-hub" });
    setSourceEnabled(db, registered.publicId, false);
    const application = create();
    expect(application.repositorySourceId).toBe(registered.id);
    expect(getSource(db, registered.publicId).enabled).toBe(true);
  });

  it("refuses a URL with credentials without storing or repeating the token (Credentials in the URL)", () => {
    const error = refusal({ repositoryUrl: "https://user:ghp_secret123@github.com/acme/payee-hub" });
    expect(error.messagesFor("repositoryUrl")[0]).toMatch(/must not include credentials/);
    expect(JSON.stringify(error.issues)).not.toContain("ghp_secret123");
    expect(JSON.stringify(db.$client.prepare("select * from repository_sources").all())).not.toContain("ghp_secret123");
  });

  it("accepts a Bitbucket Server URL on a configured host (Bitbucket Server URL)", () => {
    expect(create({ repositoryUrl: "https://bitbucket.example.com/projects/PAY/repos/payee-hub" }).repositorySourceId).not.toBeNull();
  });

  it("accepts a local repository inside an allowed root, and refuses one outside every allowed root", () => {
    const fixture = GitFixture.create("fabricate-applications");
    try {
      const repository = fixture.repo("payee-hub");
      repository.write("README.md", "fixture\n").commit("fixture");
      const local = withOverrides(config, { allowedRoots: [fixture.root] });
      const application = createApplication(db, input({ repositoryUrl: `file://${repository.path}` }), ana, local);
      expect(getApplication(db, application.publicId).repositorySourceId).not.toBeNull();
      expect(() => createApplication(db, input({ name: "Other", repositoryUrl: `file://${repository.path}` }), ana, withOverrides(config, { allowedRoots: [] }))).toThrow(ApplicationValidationError);
    } finally {
      fixture.cleanup();
    }
  });

  describe("editing details", () => {
    it("changes the name, SEAL ID, and description, keeping the slug, repository, and Portal", () => {
      const created = create();
      const edited = editApplicationDetails(db, created.publicId, { name: "Payee Hub 2", sealId: "88002", description: "Payees", lockVersion: created.lockVersion }, cy);
      expect(edited).toMatchObject({ name: "Payee Hub 2", sealId: "88002", description: "Payees", slug: "payee-hub", repositorySourceId: created.repositorySourceId, portalId: access.id, lockVersion: created.lockVersion + 1 });
      expect(edited.updatedAt.getTime()).toBeGreaterThanOrEqual(created.updatedAt.getTime());
      expect(applicationHistory(db, created.id)[0]).toMatchObject({ event: "details_changed", detail: "Changed the name, SEAL ID and description", actor: "cy@example.com", attribution: "unverified" });
    });

    it("refuses a save based on an older version (Two operators edit one Application)", () => {
      const created = create();
      editApplicationDetails(db, created.publicId, { name: "Payee Hub", sealId: "88001", description: "First", lockVersion: created.lockVersion }, ana);
      expect(() => editApplicationDetails(db, created.publicId, { name: "Payee Hub", sealId: "88001", description: "Second", lockVersion: created.lockVersion }, cy)).toThrow(StaleRecordError);
      expect(getApplication(db, created.publicId).description).toBe("First");
    });
  });
});
