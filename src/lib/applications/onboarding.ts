import type { JsonObject } from "@repo-facts/contract";
import { mirrorPath } from "@/lib/acquisition/mirror";
import { type FrontendRegistryConfig, getConfig } from "@/lib/config";
import type { Executor } from "@/lib/db/client";
import { ValidationError } from "@/lib/db/errors";
import { GitRunner } from "@/lib/git/runner";
import { type PackageTraits, type PackageVerdict, packageTraits } from "@/lib/previews/eligibility";
import { type PreviewPreparation, preparationPackages } from "@/lib/previews/records";
import { previewPinRef } from "@/lib/previews/refs";
import { InvalidCloneUrl } from "@/lib/repositories/clone-url";
import { registerRepository, resolveCloneUrl } from "@/lib/repositories/registration";
import { type Repository, findRepositoryByCanonicalUrl, listRepositories } from "@/lib/repositories/repository-records";
import { BoundaryViolation, SourceBoundary } from "@/lib/repositories/source-boundary";
import { SnapshotReader } from "@/lib/snapshot/reader";
import { applicationOfPackage } from "./records";

/**
 * What onboarding shows at each step (applications/onboarding spec; design
 * decision 10): the Repositories that match a search, a clone URL registered
 * or found, the packages a decided commit can build, and the details its
 * manifest suggests. The eligibility check itself is prepareBranch in
 * pipeline.ts, and creating is createApplication.
 */

/** How many Repositories a search lists; a more specific search narrows them. */
const SEARCH_LIMIT = 10;

/** The Repositories whose name or clone URL contains +search+, ignoring case, by name; none for an empty search. */
export function searchRepositories(db: Executor, search: string): { matches: Repository[]; more: boolean } {
  const term = search.trim().toLowerCase();
  if (!term) return { matches: [], more: false };
  const found = listRepositories(db).filter((repository) => repository.name.toLowerCase().includes(term) || repository.cloneUrl.toLowerCase().includes(term));
  return { matches: found.slice(0, SEARCH_LIMIT), more: found.length > SEARCH_LIMIT };
}

/**
 * The Repository a clone URL names: the one in the catalog with its
 * canonical identity, or a new one registered under the catalog's rules
 * (spec, "The repository is chosen or added"). Throws ValidationError, on
 * `cloneUrl`, with the catalog's reason for a URL it rejects.
 */
export function repositoryForCloneUrl(db: Executor, cloneUrl: string, config: FrontendRegistryConfig = getConfig()): { repository: Repository; registered: boolean } {
  const boundary = new SourceBoundary(config);
  let canonicalUrl: string;
  try {
    canonicalUrl = resolveCloneUrl(cloneUrl.trim(), boundary).canonicalUrl;
  } catch (error) {
    if (error instanceof InvalidCloneUrl || error instanceof BoundaryViolation) throw new ValidationError([{ field: "cloneUrl", message: error.message }]);
    throw error;
  }
  const existing = findRepositoryByCanonicalUrl(db, canonicalUrl);
  if (existing) return { repository: existing, registered: false };
  return { repository: registerRepository(db, { name: "", cloneUrl: cloneUrl.trim(), gitRef: "" }, boundary), registered: true };
}

/** A package a decided commit has, as the package step lists it. */
export interface OnboardingPackage {
  readonly directory: string;
  readonly name: string | null;
  readonly qualifies: boolean;
  readonly traits: PackageTraits;
  /** Why it can't be previewed: its first failed condition. */
  readonly reason: string | null;
  /** The application it already is, if any. */
  readonly taken: { readonly name: string; readonly slug: string } | null;
}

/** Every package of a decided commit: those that qualify first, each with the application it already is. */
export function onboardingPackages(db: Executor, preparation: PreviewPreparation): OnboardingPackage[] {
  return preparationPackages(preparation)
    .map((verdict: PackageVerdict): OnboardingPackage => {
      const taken = applicationOfPackage(db, preparation.repositoryId, verdict.directory);
      return {
        directory: verdict.directory,
        name: verdict.name,
        qualifies: verdict.qualifies,
        traits: packageTraits(verdict),
        reason: verdict.conditions.find((condition) => !condition.passed)?.reason ?? null,
        taken: taken ? { name: taken.name, slug: taken.slug } : null,
      };
    })
    .sort((a, b) => Number(b.qualifies) - Number(a.qualifies) || (a.directory < b.directory ? -1 : a.directory > b.directory ? 1 : 0));
}

/**
 * The name and description a package's manifest suggests (spec, "The
 * application is named and described"): its package name made readable,
 * `@acme/orders-portal` as "Orders portal", and its description. Read from
 * the commit's committed package.json, which the preparation pinned; a
 * manifest that can't be read suggests its name alone, or nothing.
 */
export async function suggestedDetails(preparation: PreviewPreparation, repository: Pick<Repository, "publicId">, packageDir: string, options: { config?: FrontendRegistryConfig; runner?: GitRunner } = {}): Promise<{ name: string; description: string }> {
  const config = options.config ?? getConfig();
  const verdict = preparationPackages(preparation).find((candidate) => candidate.directory === packageDir);
  const fallback = { name: verdict?.name ? readableName(verdict.name) : "", description: "" };
  try {
    const runner = options.runner ?? new GitRunner({ config });
    const reader = await SnapshotReader.open(runner, mirrorPath(config.repositoryStorage, repository.publicId), previewPinRef(preparation.commitSha), preparation.commitSha, config.analysis);
    const file = packageDir === "." ? "package.json" : `${packageDir}/package.json`;
    const result = (await reader.readMany([file])).get(file);
    if (!result?.ok) return fallback;
    const manifest = JSON.parse(result.content.text ?? "") as JsonObject;
    return {
      name: typeof manifest.name === "string" ? readableName(manifest.name) : fallback.name,
      description: typeof manifest.description === "string" ? manifest.description.trim().slice(0, 280) : "",
    };
  } catch {
    return fallback;
  }
}

/** A package name as a person would write it: without its scope, words separated, the first capitalized. */
export function readableName(packageName: string): string {
  const words = packageName
    .replace(/^@[^/]+\//, "")
    .split(/[-_.\s]+/)
    .filter(Boolean)
    .join(" ")
    .slice(0, 80);
  return words ? words[0]!.toUpperCase() + words.slice(1) : "";
}
