import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import { type Executor, immediate } from "@/lib/db/client";
import { type Issue, ValidationError, isUniqueViolation } from "@/lib/db/errors";
import { generatePublicId } from "@/lib/db/ids";
import { type DemoEnvironment, demoApplications } from "@/lib/db/schema";
import type { DemoApplication } from "./applications";
import { BITBUCKET_HOST, DEMO_DOMAIN, defaultRepositoryName, isProjectKey, isRepositoryName } from "./bitbucket";
import { type StageScript, type Template, stagesFor } from "./catalog";
import { assertApplicationCapacity } from "./workspaces";

export { BITBUCKET_HOST, DEMO_DOMAIN, defaultRepositoryName, isProjectKey, isRepositoryName } from "./bitbucket";

/**
 * Simulated deployments (template-demo/deployments spec). Nothing here builds,
 * deploys, or contacts BitBucket: every URL and repository location is derived
 * from the visitor's input and workspace, on reserved example domains.
 */

export const APP_NAME_LIMIT = 80;

export interface DeployInput {
  name: string;
  environment: string;
  project: string;
  repository: string;
}

export interface DeployValues {
  readonly name: string;
  readonly environment: DemoEnvironment;
  readonly project: string | null;
  readonly repository: string | null;
}

/** Validates the deploy form, returning every problem at once. */
export function validateDeployInput(input: DeployInput): DeployValues {
  const issues: Issue[] = [];
  const name = input.name.trim().replace(/\s+/g, " ");
  if (!name) issues.push({ field: "name", message: "Enter an application name" });
  else if (name.length > APP_NAME_LIMIT) issues.push({ field: "name", message: `Use at most ${APP_NAME_LIMIT} characters` });

  const environment = input.environment === "dev" ? "dev" : input.environment === "sandbox" ? "sandbox" : null;
  if (!environment) issues.push({ field: "environment", message: "Choose Sandbox or Dev environment" });

  let project: string | null = null;
  let repository: string | null = null;
  if (environment === "dev") {
    project = input.project.trim();
    repository = input.repository.trim();
    if (!project) issues.push({ field: "project", message: "Enter the BitBucket project key" });
    else if (!isProjectKey(project)) issues.push({ field: "project", message: "Use 2 to 10 uppercase letters and digits, starting with a letter, such as PAY" });
    if (!repository) issues.push({ field: "repository", message: "Enter a repository name" });
    else if (!isRepositoryName(repository))
      issues.push({ field: "repository", message: "Use 3 to 62 lowercase letters, digits, and hyphens, starting with a letter and not ending with a hyphen" });
  }

  if (issues.length) throw new ValidationError(issues);
  return { name, environment: environment!, project, repository };
}

function shortHash(...parts: (string | number)[]): string {
  return Number.parseInt(crypto.createHash("sha256").update(parts.join("\u0000")).digest("hex").slice(0, 8), 16).toString(36).padStart(4, "0").slice(-4);
}

/** The simulated address of an application: the same name, environment, and workspace always give the same URL. */
export function simulatedUrl(workspaceId: number, name: string, environment: DemoEnvironment): string {
  const slug = defaultRepositoryName(name).slice(0, 40).replace(/-+$/, "");
  return `https://${slug}-${shortHash(workspaceId, name, environment)}.${environment}.${DEMO_DOMAIN}`;
}

export function repositoryUrl(project: string, repository: string): string {
  return `https://${BITBUCKET_HOST}/projects/${project}/repos/${repository}`;
}

export function applicationUrl(application: Pick<DemoApplication, "workspaceId" | "name" | "environment">): string {
  return simulatedUrl(application.workspaceId, application.name, application.environment);
}

/** A template's reference deployment's simulated address, shown in preview mode's browser window. */
export function referenceUrl(slug: string): string {
  return `https://${slug}-preview.${DEMO_DOMAIN}`;
}

/** The scripted stages of an application's simulated build. */
export function buildScriptFor(application: DemoApplication, template: Template): StageScript[] {
  const project = application.bitbucketProject;
  const repository = application.bitbucketRepository;
  return stagesFor(
    application.environment,
    {
      templateSlug: template.slug,
      templateVersion: template.version,
      url: applicationUrl(application),
      project,
      repository,
      repositoryUrl: project && repository ? repositoryUrl(project, repository) : null,
    },
  );
}

/** Creates an application from a template in the visitor's workspace; its build starts now. */
export function createApplication(db: Executor, workspaceId: number, template: Template, values: DeployValues, now = new Date()): DemoApplication {
  return immediate(db, (tx) => {
    assertApplicationCapacity(tx, workspaceId);
    if (values.environment === "dev") rejectExistingRepository(tx, workspaceId, values.project!, values.repository!);
    try {
      return tx
        .insert(demoApplications)
        .values({
          publicId: generatePublicId("app"),
          workspaceId,
          templateSlug: template.slug,
          name: values.name,
          environment: values.environment,
          bitbucketProject: values.project,
          bitbucketRepository: values.repository,
          createdAt: now,
        })
        .returning()
        .get();
    } catch (error) {
      if (isUniqueViolation(error)) rejectExistingRepository(tx, workspaceId, values.project!, values.repository!);
      throw error;
    }
  });
}

function rejectExistingRepository(db: Executor, workspaceId: number, project: string, repository: string): void {
  const existing = db
    .select({ id: demoApplications.id })
    .from(demoApplications)
    .where(and(eq(demoApplications.workspaceId, workspaceId), eq(demoApplications.bitbucketProject, project), eq(demoApplications.bitbucketRepository, repository)))
    .get();
  if (existing) throw new ValidationError([{ field: "repository", message: `${repository} already exists in ${project}` }]);
}

/** Completes the remaining simulated build at once. */
export function skipBuild(db: Executor, applicationId: number, now = new Date()): void {
  db.update(demoApplications).set({ buildSkippedAt: now }).where(eq(demoApplications.id, applicationId)).run();
}

/** Deletes an application with its comment threads and share links. */
export function deleteApplication(db: Executor, applicationId: number): void {
  db.delete(demoApplications).where(eq(demoApplications.id, applicationId)).run();
}
