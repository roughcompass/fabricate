import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApplication } from "@/lib/applications/pipeline";
import { applicationsHref, deleteApplication, findApplication, getApplication, listApplications, parseApplicationQuery, slugFor, updateApplicationDetails } from "@/lib/applications/records";
import { deleteRepository } from "@/lib/repositories/registration";
import type { Repository } from "@/lib/repositories/repository-records";
import { type FrontendRegistryConfig, getConfig, setConfig, withOverrides } from "@/lib/config";
import { NotFoundError, StaleRecordError, ValidationError } from "@/lib/db/errors";
import { applications, jobs, previewBuilds } from "@/lib/db/schema";
import { PreviewAccessError, findEnrollment, isEnrolled } from "@/lib/previews/access";
import { BUILD_PREVIEW, failAttempt, findPreview } from "@/lib/previews/records";
import { buildRepository } from "../support/builders";
import { decidedPreparation, onboard, qualifyingVerdict, refusedVerdict } from "../support/applications";
import { publishFiles } from "../support/previews";
import { useAppDb } from "../support/next";

/*
 * Application records (add-applications, task 1.2): creating one from a
 * decided preparation, which starts its first build; finding it by its slug;
 * listing with search, filters, and pages; renaming; and deleting.
 */

describe("application records", () => {
  const original = getConfig();
  const app = useAppDb();
  let repository: Repository;
  let config: FrontendRegistryConfig;

  beforeEach(() => {
    repository = buildRepository(app.db, { name: "spa-orders", cloneUrl: "https://git.example.com/acme/spa-orders.git" });
    config = withOverrides(original, { previews: { enabled: true, trustedSources: [repository.canonicalUrl] } });
    setConfig(config);
  });
  afterEach(() => setConfig(original));

  const issues = (work: () => unknown): Record<string, string[]> => {
    try {
      work();
    } catch (error) {
      if (!(error instanceof ValidationError)) throw error;
      return Object.fromEntries(error.issues.map((issue) => [issue.field, error.messagesFor(issue.field)]));
    }
    throw new Error("expected a ValidationError");
  };

  describe("creating", () => {
    it("records the application with a slug from its name, and queues its first build at once (Creating Orders portal)", () => {
      const created = onboard(app.db, config, repository, { name: "  Orders   portal ", description: " Order tracking for partners " });
      expect(created).toMatchObject({ slug: "orders-portal", name: "Orders portal", nameKey: "orders portal", description: "Order tracking for partners", packageDir: ".", trackedRef: "refs/heads/main", latestOutcome: "building", currentPreviewId: null });
      expect(created.publicId).toMatch(/^app_[a-z0-9]{16}$/);

      const shown = getApplication(app.db, "orders-portal");
      expect(shown).toMatchObject({ status: "building", image: "placeholder", settling: true, trackedBranch: "main", repository: { publicId: repository.publicId, name: "spa-orders" }, current: null, screenshot: null });
      expect(shown.latest.build).toMatchObject({ attempt: 1, attemptState: "queued" });
      expect(shown.facts).toEqual({ frameworks: ["React"], buildTool: "Vite", packageManager: "pnpm" });
      expect(app.db.select().from(jobs).where(eq(jobs.kind, BUILD_PREVIEW)).all()).toHaveLength(1);
    });

    it("refuses a name another application has in any case, and keeps nothing (Duplicate name)", () => {
      onboard(app.db, config, repository, { name: "Orders portal" });
      const preparation = decidedPreparation(app.db, repository, [qualifyingVerdict("apps/admin")]);
      expect(issues(() => onboard(app.db, config, repository, { name: "orders PORTAL", packageDir: "apps/admin", preparation }))).toEqual({ name: ["Orders portal is already the name of an application. Choose another name."] });
      expect(app.db.select().from(applications).all()).toHaveLength(1);
    });

    it("refuses a package that's already an application, naming it (Package already onboarded)", () => {
      onboard(app.db, config, repository, { name: "Orders portal" });
      expect(issues(() => onboard(app.db, config, repository, { name: "Orders again" }))).toEqual({ package: ["This package is already the application Orders portal"] });
    });

    it("refuses a package that doesn't qualify, a missing or long name, and a long description", () => {
      const preparation = decidedPreparation(app.db, repository, [qualifyingVerdict("."), refusedVerdict("packages/ledger")]);
      expect(issues(() => createApplication(app.db, { repository: repository.publicId, branch: "main", packageDir: "packages/ledger", preparation: preparation.publicId, name: " ", description: "x".repeat(281), trusted: true }, config))).toEqual({
        name: ["Enter a name"],
        description: ["Use at most 280 characters"],
        package: ["Choose a package that can be previewed"],
      });
      expect(issues(() => createApplication(app.db, { repository: repository.publicId, branch: "main", packageDir: ".", preparation: preparation.publicId, name: "x".repeat(81), description: "", trusted: true }, config))).toEqual({ name: ["Use at most 80 characters"] });
      expect(issues(() => createApplication(app.db, { repository: repository.publicId, branch: "refs/tags/v1", packageDir: ".", preparation: preparation.publicId, name: "Ledger", description: "", trusted: true }, config))).toEqual({ branch: ["Choose a branch"] });
    });

    it("refuses while previews are off", () => {
      expect(() => onboard(app.db, withOverrides(config, { previews: { enabled: false } }), repository)).toThrow(PreviewAccessError);
      expect(app.db.select().from(applications).all()).toEqual([]);
    });

    it("refuses without the trust confirmation, and creates nothing (Trust not confirmed)", () => {
      const preparation = decidedPreparation(app.db, repository);
      const unenrolled = withOverrides(config, { previews: { trustedSources: [] } });
      expect(issues(() => createApplication(app.db, { repository: repository.publicId, branch: "main", packageDir: ".", preparation: preparation.publicId, name: "Orders portal", description: "", trusted: false }, unenrolled))).toEqual({
        trusted: ["Confirm that you trust this repository's code. Creating the application builds and serves it."],
      });
      expect(app.db.select().from(applications).all()).toEqual([]);
      expect(isEnrolled(app.db, unenrolled, repository)).toBe(false);
    });

    it("enrolls the remote with the application, recording which one, and keeps it when every application of the remote is deleted", () => {
      const unenrolled = withOverrides(config, { previews: { trustedSources: [] } });
      expect(isEnrolled(app.db, unenrolled, repository)).toBe(false);
      const created = onboard(app.db, unenrolled, repository, { name: "Orders portal" });
      expect(isEnrolled(app.db, unenrolled, repository)).toBe(true);
      expect(findEnrollment(app.db, repository.canonicalUrl)).toMatchObject({ applicationPublicId: created.publicId, applicationName: "Orders portal" });

      // A second application of the remote finds it enrolled already.
      const admin = onboard(app.db, unenrolled, repository, { name: "Admin", packageDir: "apps/admin", preparation: decidedPreparation(app.db, repository, [qualifyingVerdict("apps/admin")]) });
      expect(findEnrollment(app.db, repository.canonicalUrl)?.applicationPublicId).toBe(created.publicId);

      deleteApplication(app.db, created.publicId);
      deleteApplication(app.db, admin.publicId);
      expect(isEnrolled(app.db, unenrolled, repository)).toBe(true);
      // Pointing the Repository at another remote ends it, as with the configured list.
      expect(isEnrolled(app.db, unenrolled, { ...repository, canonicalUrl: "https://git.example.com/acme/spa-orders-fork" })).toBe(false);
      expect(isEnrolled(app.db, withOverrides(unenrolled, { previews: { enabled: false } }), repository)).toBe(false);
    });

    it("derives a free slug that never takes an address /applications uses", () => {
      onboard(app.db, config, repository, { name: "Orders portal" });
      expect(slugFor(app.db, "Orders Portal!")).toBe("orders-portal-2");
      expect(slugFor(app.db, "New")).toBe("new-application");
      expect(slugFor(app.db, "Café crème")).toBe("cafe-creme");
      expect(slugFor(app.db, "日本")).toBe("application");
    });
  });

  describe("finding", () => {
    it("finds an application by its slug, and nothing for another", () => {
      onboard(app.db, config, repository);
      expect(findApplication(app.db, "orders-portal")?.name).toBe("Orders portal");
      expect(findApplication(app.db, "orders")).toBeUndefined();
      expect(() => getApplication(app.db, "orders")).toThrow(NotFoundError);
    });
  });

  describe("listing", () => {
    /** An application of a new Repository, ready, building, or failed, using +framework+. */
    function application(name: string, options: { description?: string; framework?: string; state?: "ready" | "building" | "failed"; branch?: string } = {}) {
      const owner = buildRepository(app.db, { name: `spa-${name.toLowerCase().replace(/\W+/g, "-")}` });
      const enrolled = withOverrides(config, { previews: { trustedSources: [owner.canonicalUrl] } });
      const created = onboard(app.db, enrolled, owner, { name, description: options.description ?? "", framework: options.framework, branch: options.branch });
      const preview = app.db.select().from(previewBuilds).where(eq(previewBuilds.id, created.latestPreviewId!)).get()!;
      if (options.state === "ready") publishFiles(app.db, enrolled, preview, { "index.html": "<!doctype html>" });
      if (options.state === "failed") failAttempt(app.db, preview.publicId, { attempt: 1 }, "The install failed");
      return created;
    }

    it("lists every application by name with its count (Opening Applications)", () => {
      application("Payments hub", { state: "ready" });
      application("Orders portal", { state: "building" });
      application("admin console", { state: "failed" });
      const listing = listApplications(app.db);
      expect(listing.items.map((item) => item.name)).toEqual(["admin console", "Orders portal", "Payments hub"]);
      expect(listing).toMatchObject({ matched: 3, total: 3, page: 1, pages: 1, from: 1, to: 3 });
      expect(listing.items.map((item) => item.status)).toEqual(["build_failed", "building", "ready"]);
    });

    it("searches names, descriptions, repositories, and branches, ignoring case (Searching)", () => {
      application("Orders portal");
      application("Payments hub", { description: "Pays ORDERS out" });
      application("Admin", { branch: "feature/orders-export" });
      application("Ledger");
      const names = (q: string) => listApplications(app.db, parseApplicationQuery({ q })).items.map((item) => item.name);
      expect(names("orders")).toEqual(["Admin", "Orders portal", "Payments hub"]);
      expect(names("spa-ledger")).toEqual(["Ledger"]);
      expect(names("nothing like it")).toEqual([]);
      expect(applicationsHref(parseApplicationQuery({ q: "  orders  " }))).toBe("/applications?q=orders");
    });

    it("combines options within a group with OR and groups with AND, counting each option against the rest (React applications that failed)", () => {
      application("Orders portal", { framework: "react", state: "failed" });
      application("Payments hub", { framework: "react", state: "ready" });
      application("Admin", { framework: "vue", state: "failed" });
      application("Ledger", { framework: "svelte", state: "building" });
      const query = parseApplicationQuery({ framework: "React", status: ["failed", "unknown"] });
      expect(query).toEqual({ search: "", frameworks: ["React"], statuses: ["failed"], page: 1 });
      const listing = listApplications(app.db, query);
      expect(listing.items.map((item) => item.name)).toEqual(["Orders portal"]);
      expect(listing.frameworks).toEqual([
        { value: "React", count: 1 },
        { value: "Svelte", count: 0 },
        { value: "Vue", count: 1 },
      ]);
      expect(listing.statuses).toEqual([
        { value: "ready", count: 1 },
        { value: "building", count: 0 },
        { value: "failed", count: 1 },
      ]);
      expect(applicationsHref(query)).toBe("/applications?framework=React&status=failed");
      expect(listApplications(app.db, parseApplicationQuery({ framework: ["React", "Vue"] })).matched).toBe(3);
    });

    it("shows 24 to a page, keeps the page in the address, and clamps a page past the end (Many applications)", () => {
      for (let index = 1; index <= 60; index++) application(`App ${String(index).padStart(2, "0")}`);
      const first = listApplications(app.db);
      expect(first).toMatchObject({ matched: 60, page: 1, pages: 3, from: 1, to: 24 });
      expect(first.items).toHaveLength(24);
      const last = listApplications(app.db, parseApplicationQuery({ page: "3" }));
      expect(last).toMatchObject({ page: 3, from: 49, to: 60 });
      expect(last.items[0]!.name).toBe("App 49");
      expect(listApplications(app.db, parseApplicationQuery({ page: "9" })).page).toBe(3);
      expect(parseApplicationQuery({ page: "-2" }).page).toBe(1);
      expect(applicationsHref({ ...parseApplicationQuery({ q: "App" }), page: 2 })).toBe("/applications?q=App&page=2");
      expect(applicationsHref(parseApplicationQuery({}))).toBe("/applications");
    }, 30_000);
  });

  describe("changing", () => {
    it("renames an application and keeps its address (Renaming)", () => {
      const created = onboard(app.db, config, repository);
      const renamed = updateApplicationDetails(app.db, created.publicId, created.lockVersion, { name: "Partner orders", description: "For partners" });
      expect(renamed).toMatchObject({ slug: "orders-portal", name: "Partner orders", nameKey: "partner orders", description: "For partners" });
      expect(findApplication(app.db, "orders-portal")?.name).toBe("Partner orders");
      expect(() => updateApplicationDetails(app.db, created.publicId, created.lockVersion, { name: "Other", description: "" })).toThrow(StaleRecordError);
    });

    it("refuses a rename to another application's name in any case, and allows a change of case of its own", () => {
      onboard(app.db, config, repository, { name: "Orders portal" });
      const preparation = decidedPreparation(app.db, repository, [qualifyingVerdict("apps/admin")]);
      const admin = onboard(app.db, config, repository, { name: "Admin", packageDir: "apps/admin", preparation });
      expect(() => updateApplicationDetails(app.db, admin.publicId, admin.lockVersion, { name: "ORDERS PORTAL", description: "" })).toThrow(/Orders portal is already the name of an application/);
      expect(updateApplicationDetails(app.db, admin.publicId, admin.lockVersion, { name: "ADMIN", description: "" }).name).toBe("ADMIN");
    });

    it("deletes an application and leaves its builds as the Repository's previews (Deleting)", () => {
      const created = onboard(app.db, config, repository);
      expect(deleteApplication(app.db, created.publicId)).toBe(true);
      expect(deleteApplication(app.db, created.publicId)).toBe(false);
      expect(findApplication(app.db, "orders-portal")).toBeUndefined();
      expect(app.db.select().from(previewBuilds).all()).toHaveLength(1);
    });

    it("deletes a Repository's applications with it", () => {
      const created = onboard(app.db, config, repository);
      deleteRepository(app.db, repository.publicId, "spa-orders");
      expect(findApplication(app.db, created.slug)).toBeUndefined();
      expect(findPreview(app.db, app.db.select().from(previewBuilds).get()!.publicId)).toBeUndefined();
    });
  });
});
