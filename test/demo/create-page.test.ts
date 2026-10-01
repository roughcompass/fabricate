import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db/client";
import { ValidationError } from "@/lib/db/errors";
import { buildProgress } from "@/lib/demo/build";
import { BRAND_IDS, TEMPLATES, templateBySlug, totalDuration } from "@/lib/demo/catalog";
import { BITBUCKET_PROJECTS, BITBUCKET_REPOSITORIES, applicationNameFor, findRepository, repositoriesIn } from "@/lib/demo/catalog/repositories";
import { BITBUCKET_HOST, buildScriptFor, createApplication, importRepository, isProjectKey, isRepositoryName, validateDeployInput } from "@/lib/demo/deployments";
import { galleryOrder } from "@/lib/demo/gallery";
import { CHIP_COUNT, chipSetCount, chipTemplates, nextChipSet, parseChipSet, routePrompt } from "@/lib/demo/prompt";
import { newWorkspaceKey } from "@/lib/demo/workspace-key";
import { ensureWorkspace } from "@/lib/demo/workspaces";
import { createTestDb } from "../support/db";

describe("prompt bar", () => {
  it("opens the gallery searched for a description", () => {
    expect(routePrompt("onboarding")).toEqual({ kind: "redirect", href: "/templates?q=onboarding" });
    expect(routePrompt("  a   payments dashboard ")).toEqual({ kind: "redirect", href: "/templates?q=a+payments+dashboard" });
    // A sentence that mentions a domain is still a description.
    expect(routePrompt("build like example.com/app but simpler")).toMatchObject({ kind: "redirect", href: expect.stringMatching(/^\/templates\?q=/) });
  });

  it("opens the import of a repository in the demo's BitBucket, with or without a scheme", () => {
    const expected = { kind: "redirect", href: "/applications/import/PAY/payee-hub" };
    expect(routePrompt(`https://${BITBUCKET_HOST}/projects/PAY/repos/payee-hub`)).toEqual(expected);
    expect(routePrompt(`${BITBUCKET_HOST}/projects/PAY/repos/payee-hub/browse`)).toEqual(expected);
  });

  it("refuses other hosts, unknown repositories, and other paths", () => {
    expect(routePrompt("https://github.com/acme/payee-hub")).toEqual({ kind: "error", message: `Only repositories in the demo's BitBucket, ${BITBUCKET_HOST}, can be imported.` });
    expect(routePrompt("bitbucket.org/acme/payee-hub")).toMatchObject({ kind: "error", message: expect.stringContaining("Only repositories in the demo's BitBucket") });
    expect(routePrompt(`https://${BITBUCKET_HOST}/projects/PAY/repos/missing-repo`)).toEqual({ kind: "error", message: "The demo's BitBucket has no repository PAY/missing-repo." });
    expect(routePrompt(`https://${BITBUCKET_HOST}/dashboard`)).toMatchObject({ kind: "error", message: expect.stringContaining("Paste a repository URL") });
    expect(routePrompt("   ")).toEqual({ kind: "error", message: "Describe what you want to build, or paste a repository URL." });
  });
});

describe("quick-start chips", () => {
  it("shows four templates at a time in the gallery's fixed order, starting with the heroes", () => {
    const ordered = galleryOrder(TEMPLATES);
    expect(chipTemplates(0)).toEqual(ordered.slice(0, CHIP_COUNT));
    expect(chipTemplates(0).every((template) => template.hero)).toBe(true);
    expect(chipTemplates(1)).toEqual(ordered.slice(CHIP_COUNT, CHIP_COUNT * 2));
  });

  it("cycles through every template and back to the first set", () => {
    const sets = chipSetCount();
    const seen = new Set<string>();
    let set = 0;
    for (let step = 0; step < sets; step++) {
      for (const template of chipTemplates(set)) seen.add(template.slug);
      set = nextChipSet(set);
    }
    expect(set).toBe(0);
    expect(seen.size).toBe(TEMPLATES.length);
  });

  it("wraps a partial last set around to the start of the catalog", () => {
    const five = galleryOrder(TEMPLATES).slice(0, 5);
    expect(chipSetCount(five)).toBe(2);
    expect(chipTemplates(1, five).map((template) => template.slug)).toEqual([five[4]!, five[0]!, five[1]!, five[2]!].map((template) => template.slug));
  });

  it("reads the chip set from the address, treating anything unknown as the first", () => {
    expect(parseChipSet("2")).toBe(2);
    expect(parseChipSet(String(chipSetCount()))).toBe(0);
    for (const value of [undefined, "", "-1", "x", "1.5", "99999"]) expect(parseChipSet(value)).toBe(0);
    expect(parseChipSet(["1", "3"])).toBe(1);
  });
});

describe("the demo's BitBucket", () => {
  it("lists PAY, GB, MKT, and OPS, each with repositories", () => {
    expect(BITBUCKET_PROJECTS.map((project) => project.key)).toEqual(["PAY", "GB", "MKT", "OPS"]);
    for (const project of BITBUCKET_PROJECTS) expect(repositoriesIn(project.key).length, project.key).toBeGreaterThanOrEqual(2);
  });

  it("builds every repository from a catalog template, with valid and unique names per project", () => {
    const names = new Set<string>();
    for (const repository of BITBUCKET_REPOSITORIES) {
      const key = `${repository.project}/${repository.name}`;
      expect(templateBySlug(repository.templateSlug), key).toBeDefined();
      expect(isProjectKey(repository.project), key).toBe(true);
      expect(isRepositoryName(repository.name), key).toBe(true);
      expect(repository.updated, key).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(names.has(key), key).toBe(false);
      names.add(key);
    }
    // Every brand can be imported.
    expect(new Set(BITBUCKET_REPOSITORIES.map((repository) => templateBySlug(repository.templateSlug)!.brand))).toEqual(new Set(BRAND_IDS));
  });

  it("names an imported application after its repository", () => {
    expect(applicationNameFor({ name: "payee-hub" })).toBe("Payee hub");
    expect(applicationNameFor({ name: "fx-board" })).toBe("Fx board");
  });
});

describe("importing a repository", () => {
  let db: Db;
  let workspaceId: number;
  const payeeHub = findRepository("PAY", "payee-hub")!;
  beforeEach(() => {
    db = createTestDb();
    workspaceId = ensureWorkspace(db, newWorkspaceKey()).id;
  });
  afterEach(() => db.$client.close());

  it("creates a dev environment application from the repository's template, recorded as imported", () => {
    const application = importRepository(db, workspaceId, payeeHub, "Payee hub");
    expect(application).toMatchObject({ templateSlug: "payments-workspace", name: "Payee hub", environment: "dev", bitbucketProject: "PAY", bitbucketRepository: "payee-hub", origin: "import" });
    const deployed = createApplication(db, workspaceId, templateBySlug("payments-workspace")!, validateDeployInput({ name: "Payee portal", environment: "dev", project: "PAY", repository: "payee-portal" }));
    expect(deployed.origin).toBe("template");
  });

  it("plays the import stages, which connect and clone instead of creating a repository, in about 14 seconds", () => {
    const application = importRepository(db, workspaceId, payeeHub, "Payee hub");
    const script = buildScriptFor(application, templateBySlug("payments-workspace")!);
    expect(script.map((stage) => stage.name)).toEqual([
      "Queued",
      "Connecting BitBucket repository PAY/payee-hub",
      "Cloning PAY/payee-hub",
      "Running pipeline #1",
      "Installing dependencies",
      "Building",
      "Deploying to dev",
      "Assigning URL",
    ]);
    expect(script.some((stage) => stage.name.startsWith("Creating BitBucket repository"))).toBe(false);
    expect(totalDuration(script)).toBe(14_000);
    const created = application.createdAt.getTime();
    expect(buildProgress(script, created, created + 13_999).status).toBe("building");
    expect(buildProgress(script, created, created + 14_000).status).toBe("ready");
  });

  it("refuses a repository already imported or deployed to in the same workspace", () => {
    importRepository(db, workspaceId, payeeHub, "Payee hub");
    const refusal = () => importRepository(db, workspaceId, payeeHub, "Payee hub again");
    expect(refusal).toThrow(ValidationError);
    expect(refusal).toThrow(/payee-hub already exists in PAY/);

    createApplication(db, workspaceId, templateBySlug("corporate-card-controls")!, validateDeployInput({ name: "Cards", environment: "dev", project: "PAY", repository: "card-controls" }));
    expect(() => importRepository(db, workspaceId, findRepository("PAY", "card-controls")!, "Card controls")).toThrow(/card-controls already exists in PAY/);

    // Another workspace can import the same repository.
    const other = ensureWorkspace(db, newWorkspaceKey()).id;
    expect(() => importRepository(db, other, payeeHub, "Payee hub")).not.toThrow();
  });

  it("validates the application name", () => {
    expect(() => importRepository(db, workspaceId, payeeHub, "  ")).toThrow(ValidationError);
    expect(() => importRepository(db, workspaceId, payeeHub, "x".repeat(81))).toThrow(ValidationError);
  });
});
