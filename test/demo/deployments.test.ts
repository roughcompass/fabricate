import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db/client";
import { ValidationError } from "@/lib/db/errors";
import { demoComments, demoShares, demoThreads } from "@/lib/db/schema";
import { applicationCount } from "@/lib/demo/workspaces";
import { resolveView } from "@/lib/demo/access";
import { templateBySlug } from "@/lib/demo/catalog";
import { runtimeDescriptor } from "@/lib/demo/runtime-view";
import {
  BITBUCKET_HOST,
  createApplication,
  defaultRepositoryName,
  deleteApplication,
  isProjectKey,
  isRepositoryName,
  referenceUrl,
  repositoryUrl,
  simulatedUrl,
  validateDeployInput,
} from "@/lib/demo/deployments";
import { newWorkspaceKey } from "@/lib/demo/workspace-key";
import { APPLICATION_LIMIT, DemoLimitError, ensureWorkspace } from "@/lib/demo/workspaces";
import { createTestDb } from "../support/db";

const template = templateBySlug("payments-workspace")!;
const sandbox = { name: "Payments workspace", environment: "sandbox", project: "", repository: "" };
const dev = { name: "Payee portal", environment: "dev", project: "PAY", repository: "payee-portal" };

const issuesOf = (work: () => unknown) => {
  try {
    work();
  } catch (error) {
    if (error instanceof ValidationError) return Object.fromEntries(error.issues.map((issue) => [issue.field, issue.message]));
    throw error;
  }
  return {};
};

describe("BitBucket rules", () => {
  it.each(["PAY", "GB2", "AB", "MARKETS123"])("accepts the project key %s", (key) => expect(isProjectKey(key)).toBe(true));
  it.each(["pay-1", "P", "1PAY", "PAY-1", "ABCDEFGHIJK", "pay"])("rejects the project key %s", (key) => expect(isProjectKey(key)).toBe(false));

  it.each(["payee-portal", "abc", "a1b", `a${"b".repeat(61)}`])("accepts the repository name %s", (name) => expect(isRepositoryName(name)).toBe(true));
  it.each(["ab", "Payee", "payee-", "-payee", "1payee", "payee_portal", `a${"b".repeat(62)}`])("rejects the repository name %s", (name) => expect(isRepositoryName(name)).toBe(false));

  it("derives a valid default repository name from any application name", () => {
    expect(defaultRepositoryName("Payee portal")).toBe("payee-portal");
    expect(defaultRepositoryName("  Tomás's Deal Room!! ")).toBe("tomas-s-deal-room");
    expect(defaultRepositoryName("2026 plan")).toBe("app-2026-plan");
    expect(defaultRepositoryName("X")).toBe("x-app");
    for (const name of ["Payee portal", "2026 plan", "X", "—", "a".repeat(100), "Ünïcödé café"]) expect(isRepositoryName(defaultRepositoryName(name)), name).toBe(true);
  });
});

describe("deploy form validation", () => {
  it("accepts a sandbox with no BitBucket details", () => {
    expect(validateDeployInput(sandbox)).toEqual({ name: "Payments workspace", environment: "sandbox", project: null, repository: null });
  });

  it("requires BitBucket details for a dev environment and reports every problem", () => {
    expect(issuesOf(() => validateDeployInput({ ...dev, project: "", repository: "" }))).toEqual({
      project: "Enter the BitBucket project key",
      repository: "Enter a repository name",
    });
    expect(issuesOf(() => validateDeployInput({ ...dev, project: "pay-1" })).project).toMatch(/uppercase letters and digits/);
    expect(issuesOf(() => validateDeployInput({ ...dev, repository: "Bad_Name" })).repository).toMatch(/lowercase letters, digits, and hyphens/);
  });

  it("rejects a blank or overlong name and an unknown environment", () => {
    expect(issuesOf(() => validateDeployInput({ ...sandbox, name: "  " })).name).toBe("Enter an application name");
    expect(issuesOf(() => validateDeployInput({ ...sandbox, name: "x".repeat(81) })).name).toMatch(/at most 80/);
    expect(issuesOf(() => validateDeployInput({ ...sandbox, environment: "production" })).environment).toBe("Choose Sandbox or Dev environment");
  });
});

describe("simulated deployment values", () => {
  it("derives the same URL from the same name, environment, and workspace", () => {
    const url = simulatedUrl(1, "Payments workspace", "sandbox");
    expect(url).toMatch(/^https:\/\/payments-workspace-[a-z0-9]{4}\.sandbox\.deweb\.example$/);
    expect(simulatedUrl(1, "Payments workspace", "sandbox")).toBe(url);
    expect(simulatedUrl(2, "Payments workspace", "sandbox")).not.toBe(url);
    expect(simulatedUrl(1, "Payments workspace", "dev")).toMatch(/\.dev\.deweb\.example$/);
  });

  it("gives each reference deployment one address, which preview mode and the running application share", () => {
    expect(referenceUrl("payments-workspace")).toBe("https://payments-workspace-preview.deweb.example");
    const db = createTestDb();
    try {
      const view = resolveView(db, "ref-payments-workspace", null)!;
      expect(runtimeDescriptor(view, null, null)!.url).toBe(referenceUrl("payments-workspace"));
    } finally {
      db.$client.close();
    }
  });

  it("places repositories on the reserved example domain", () => {
    expect(repositoryUrl("PAY", "payee-portal")).toBe(`https://${BITBUCKET_HOST}/projects/PAY/repos/payee-portal`);
    expect(BITBUCKET_HOST.endsWith(".example")).toBe(true);
  });
});

describe("creating applications", () => {
  let db: Db;
  let workspaceId: number;
  beforeEach(() => {
    db = createTestDb();
    workspaceId = ensureWorkspace(db, newWorkspaceKey()).id;
  });
  afterEach(() => db.$client.close());

  it("creates sandbox and dev applications in the visitor's workspace", () => {
    const first = createApplication(db, workspaceId, template, validateDeployInput(sandbox));
    const second = createApplication(db, workspaceId, template, validateDeployInput(dev));
    expect(first).toMatchObject({ templateSlug: "payments-workspace", environment: "sandbox", bitbucketProject: null });
    expect(second).toMatchObject({ environment: "dev", bitbucketProject: "PAY", bitbucketRepository: "payee-portal" });
    expect(first.publicId).toMatch(/^app_[a-z0-9]{16}$/);
  });

  it("rejects a repository that already exists in the project, in the same workspace only", () => {
    createApplication(db, workspaceId, template, validateDeployInput(dev));
    expect(issuesOf(() => createApplication(db, workspaceId, template, validateDeployInput(dev)))).toEqual({ repository: "payee-portal already exists in PAY" });

    const other = ensureWorkspace(db, newWorkspaceKey()).id;
    expect(() => createApplication(db, other, template, validateDeployInput(dev))).not.toThrow();
    expect(() => createApplication(db, workspaceId, template, validateDeployInput({ ...dev, project: "GB" }))).not.toThrow();
  });

  it(`refuses the application after the ${APPLICATION_LIMIT}th`, () => {
    for (let index = 0; index < APPLICATION_LIMIT; index++) createApplication(db, workspaceId, template, validateDeployInput(sandbox));
    expect(() => createApplication(db, workspaceId, template, validateDeployInput(sandbox))).toThrow(DemoLimitError);
    expect(applicationCount(db, workspaceId)).toBe(APPLICATION_LIMIT);
  });

  it("deletes an application with its threads, comments, and share links", () => {
    const app = createApplication(db, workspaceId, template, validateDeployInput(sandbox));
    const thread = db
      .insert(demoThreads)
      .values({ publicId: "thr_0000000000000001", applicationId: app.id, viewWorkspaceId: workspaceId, route: "payees", member: "payee-list", memberVersion: "1.4.2", anchor: "send", offsetX: 0, offsetY: 0, createdAt: new Date() })
      .returning()
      .get();
    db.insert(demoComments).values({ publicId: "cmt_0000000000000001", threadId: thread.id, authorName: "Sam", body: "Hi", createdAt: new Date() }).run();
    db.insert(demoShares).values({ tokenDigest: "a".repeat(64), applicationId: app.id, viewWorkspaceId: workspaceId, state: "{}", createdAt: new Date() }).run();

    deleteApplication(db, app.id);
    expect(applicationCount(db, workspaceId)).toBe(0);
    expect(db.select().from(demoThreads).all()).toEqual([]);
    expect(db.select().from(demoComments).all()).toEqual([]);
    expect(db.select().from(demoShares).all()).toEqual([]);
  });
});
