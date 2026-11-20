import { and, eq, isNull } from "drizzle-orm";
import { isLockfilePath, isSensitivePath } from "@repo-facts/contract";
import { mirrorPath } from "@/lib/acquisition/mirror";
import { type FrontendRegistryConfig, getConfig } from "@/lib/config";
import { type Executor, immediate } from "@/lib/db/client";
import { previewBuilds, previewPreparations } from "@/lib/db/schema";
import { GitRunner } from "@/lib/git/runner";
import { assertEnrolled } from "@/lib/previews/access";
import { cachedRemoteRefs, forgetRemoteRefs } from "@/lib/previews/ref-cache";
import { type PreviewBuild, type PreviewPreparation, openPreparation, preparationPackages, rebuildPreview, startPreview } from "@/lib/previews/records";
import { type RefListing, type RemoteRef, pinCommit, previewPinRef } from "@/lib/previews/refs";
import { getRepository } from "@/lib/repositories/repository-records";
import { SnapshotReader } from "@/lib/snapshot/reader";
import type { Application } from "./records";

/**
 * Preview mode's other refs and its Code tab (template-preview spec, "Preview
 * mode can show another branch or tag", "The Code tab shows the repository's
 * files at the built commit"). Another branch or tag of the application's
 * remote is shown as a repository preview of the application's package at
 * that ref's commit; showing it never changes the tracked branch or the
 * current build. The Code tab reads the package's committed files at the
 * commit shown, through the snapshot reader, with the files it doesn't read
 * listed with the reason.
 */

/** What another ref's frame area shows. */
export type RefPreview =
  /** The remote has no such branch or tag, or couldn't be read. */
  | { readonly kind: "unknown"; readonly reason: string }
  /** Its commit hasn't been prepared or built for the application's package yet. */
  | { readonly kind: "unbuilt"; readonly commitSha: string }
  /** Its commit is being surveyed to decide whether it can be built. */
  | { readonly kind: "checking"; readonly commitSha: string; readonly preparation: PreviewPreparation }
  /** Its commit can't be previewed, or couldn't be checked: each reason. */
  | { readonly kind: "refused"; readonly commitSha: string; readonly reasons: readonly string[]; readonly preparation: PreviewPreparation }
  /** Its build is queued or running, with nothing published yet. */
  | { readonly kind: "building"; readonly commitSha: string; readonly preview: PreviewBuild; readonly preparation: PreviewPreparation }
  /** Its build failed, with nothing published. */
  | { readonly kind: "failed"; readonly commitSha: string; readonly preview: PreviewBuild; readonly reason: string }
  /** Its build published, possibly while a newer attempt runs. */
  | { readonly kind: "ready"; readonly commitSha: string; readonly preview: PreviewBuild };

/**
 * How many of the remote's other branches, and tags, the choice lists without a search, and how many matches a search lists.
 * @public Its tests read the limits.
 */
export const REF_LIMITS = { branches: 50, tags: 20, matches: 50 } as const;
/** Orders tags by the numbers in their names, highest first, so v2.10.0 comes before v2.9.0: the remote doesn't say when a tag was made. */
const byVersion = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

/** The branches and tags preview mode offers to choose from, and how many more the remote has. */
export interface RefChoices {
  /** The tracked branch, always first. */
  readonly tracked: string;
  /** The other branches listed, by name. */
  readonly branches: readonly RemoteRef[];
  /** The tags listed, the highest-numbered first. */
  readonly tags: readonly RemoteRef[];
  /** How many other branches and tags the remote has in all. */
  readonly total: { readonly branches: number; readonly tags: number };
  /** The search, when the choice lists what matches it, and how many branches and tags match it in all. */
  readonly find: { readonly text: string; readonly matched: number } | null;
}

/**
 * The branches and tags preview mode offers (template-preview spec,
 * "Preview mode can show another branch or tag"): the tracked branch first,
 * then the remote's other branches by name, up to REF_LIMITS.branches, and
 * its tags, highest-numbered first, up to REF_LIMITS.tags. With +find+, the
 * branches and tags whose name contains it, branches first, up to
 * REF_LIMITS.matches. +selected+, the ref shown, is always listed.
 */
export function refChoices(application: Pick<Application, "trackedRef">, listing: RefListing, options: { find?: string | null; selected?: string | null } = {}): RefChoices {
  const others = listing.refs.filter((ref) => ref.name !== application.trackedRef);
  const branches = others.filter((ref) => ref.kind === "branch");
  const tags = others.filter((ref) => ref.kind === "tag").sort((a, b) => byVersion.compare(b.label, a.label));
  const text = options.find?.trim() ?? "";
  let listed: { branches: RemoteRef[]; tags: RemoteRef[] };
  let find: RefChoices["find"] = null;
  if (text) {
    const needle = text.toLowerCase();
    const matching = (refs: RemoteRef[]) => refs.filter((ref) => ref.label.toLowerCase().includes(needle));
    const [foundBranches, foundTags] = [matching(branches), matching(tags)];
    const shownBranches = foundBranches.slice(0, REF_LIMITS.matches);
    listed = { branches: shownBranches, tags: foundTags.slice(0, REF_LIMITS.matches - shownBranches.length) };
    find = { text, matched: foundBranches.length + foundTags.length };
  } else {
    listed = { branches: branches.slice(0, REF_LIMITS.branches), tags: tags.slice(0, REF_LIMITS.tags) };
  }
  // The ref shown stays choosable, wherever it falls in the order.
  const selected = options.selected ? others.find((ref) => ref.name === options.selected) : undefined;
  if (selected && ![...listed.branches, ...listed.tags].includes(selected)) listed[selected.kind === "branch" ? "branches" : "tags"].unshift(selected);
  return { tracked: application.trackedRef, ...listed, total: { branches: branches.length, tags: tags.length }, find };
}

/** What preview mode shows for +ref+, a qualified branch or tag of the application's remote, from +listing+. */
export function refPreview(db: Executor, application: Pick<Application, "repository" | "packageDir">, ref: string, listing: RefListing): RefPreview {
  const remote = listing.refs.find((candidate) => candidate.name === ref);
  if (!remote) return { kind: "unknown", reason: listing.unavailable ? `The remote's branches and tags couldn't be listed: ${listing.unavailable}` : `The remote has no ${ref.replace(/^refs\/(heads|tags)\//, "")}.` };
  const repository = getRepository(db, application.repository.publicId);
  const commitSha = remote.commit;
  const preparation = db.select().from(previewPreparations).where(and(eq(previewPreparations.repositoryId, repository.id), eq(previewPreparations.commitSha, commitSha))).get();
  const preview = db
    .select()
    .from(previewBuilds)
    .where(and(eq(previewBuilds.repositoryId, repository.id), eq(previewBuilds.commitSha, commitSha), eq(previewBuilds.packageDir, application.packageDir), isNull(previewBuilds.deletedAt)))
    .get();
  if (preview?.artifact) return { kind: "ready", commitSha, preview };
  if (preview?.attemptState === "failed") return { kind: "failed", commitSha, preview, reason: preview.attemptReason ?? "The build failed." };
  if (preview && preparation) return { kind: "building", commitSha, preview, preparation };
  if (!preparation) return { kind: "unbuilt", commitSha };
  if (preparation.state === "profiling") return { kind: "checking", commitSha, preparation };
  if (preparation.state === "failed") return { kind: "refused", commitSha, preparation, reasons: [preparation.failure ?? "The commit couldn't be checked."] };
  const verdict = preparationPackages(preparation).find((candidate) => candidate.directory === application.packageDir);
  if (!verdict) return { kind: "refused", commitSha, preparation, reasons: ["This commit has no such package."] };
  if (!verdict.qualifies) return { kind: "refused", commitSha, preparation, reasons: verdict.conditions.filter((condition) => !condition.passed).map((condition) => condition.reason) };
  return { kind: "unbuilt", commitSha };
}

/**
 * Builds the application's package at +ref+'s head, as a repository preview:
 * pins the commit and prepares it, and once it's decided and the package
 * qualifies, starts its build, or a failed one's next attempt. Never changes
 * the application. Throws as pinCommit does for a ref that can't be read.
 */
export async function buildRef(db: Executor, application: Pick<Application, "repository" | "packageDir">, ref: string, config: FrontendRegistryConfig = getConfig()): Promise<void> {
  const repository = getRepository(db, application.repository.publicId);
  assertEnrolled(db, config, repository);
  const pinned = await pinCommit(db, repository, { kind: "ref", name: ref }, { config });
  // The remote was just read: the refs preview mode lists next are read again, so they agree with what was built.
  forgetRemoteRefs(repository);
  immediate(db, (tx) => {
    const { preparation } = openPreparation(tx, repository, pinned);
    startRefBuild(tx, preparation, application.packageDir);
  });
}

/** Starts the package's build from a decided +preparation+, when it qualifies and has no build under way or published. */
function startRefBuild(db: Executor, preparation: PreviewPreparation, packageDir: string): void {
  if (preparation.state !== "ready" || !preparationPackages(preparation).some((verdict) => verdict.directory === packageDir && verdict.qualifies)) return;
  const { preview, created } = startPreview(db, preparation.publicId, packageDir);
  if (!created && preview.attemptState === "failed" && !preview.artifact) rebuildPreview(db, preview.publicId);
}

/** The remote's refs for preview mode, read in the last `previews.refCacheSeconds` or now (ref-cache.ts). */
export function remoteRefs(application: Pick<Application, "repository">, db: Executor, config: FrontendRegistryConfig = getConfig()): Promise<RefListing> {
  return cachedRemoteRefs(getRepository(db, application.repository.publicId), { config });
}

/** A file of the package in the Code tab: its path in the package, and why it isn't shown when it's skipped. */
export interface PackageFile {
  readonly path: string;
  readonly skipped: { readonly reason: string; readonly detail: string } | null;
}

/** How many files the Code tab lists; a larger package lists these, and says how many more it has. */
const FILE_LIMIT = 2_000;

export interface PackageCode {
  readonly files: readonly PackageFile[];
  /** How many files the package has beyond those listed. */
  readonly more: number;
  /** The file shown: the one asked for when the package has it, else its manifest. */
  readonly selected: string;
  /** The selected file's text, or why it isn't shown. */
  readonly content: { readonly text: string } | { readonly skipped: string };
}

/**
 * The package's committed files at +commitSha+, which a preview pinned, as
 * the Code tab shows them: every file the snapshot reader admits and every
 * file it refuses, such as a sensitive `.npmrc`, with the reason; and the
 * text of the selected file, the package's `package.json` unless another is
 * chosen. Paths are relative to the package.
 */
export async function packageCode(application: Pick<Application, "repository" | "packageDir">, commitSha: string, selected: string | null, options: { config?: FrontendRegistryConfig; runner?: GitRunner } = {}): Promise<PackageCode> {
  const config = options.config ?? getConfig();
  const runner = options.runner ?? new GitRunner({ config });
  const reader = await SnapshotReader.open(runner, mirrorPath(config.repositoryStorage, application.repository.publicId), previewPinRef(commitSha), commitSha, config.analysis);
  const base = application.packageDir === "." ? "" : `${application.packageDir}/`;
  const inPackage = (path: string) => path.startsWith(base) && (application.packageDir === "." || !path.slice(base.length).includes("node_modules/"));
  // A sensitive file, or one over the size limit, is listed with the reason the reader would give, without reading it.
  const known = (entry: { path: string; size?: number | null }): PackageFile["skipped"] => {
    if (isSensitivePath(entry.path)) return { reason: "sensitive", detail: "Files that commonly hold credentials are recorded but never read." };
    const limit = isLockfilePath(entry.path) ? config.analysis.maxLockfileBytes : config.analysis.maxBlobBytes;
    return (entry.size ?? 0) > limit ? { reason: "blob_too_large", detail: `It's larger than the ${limit}-byte limit for a file.` } : null;
  };
  const listed: PackageFile[] = [
    ...reader
      .files()
      .filter((entry) => inPackage(entry.path))
      .map((entry) => ({ path: entry.path.slice(base.length), skipped: known(entry) })),
    ...reader
      .diagnostics()
      .filter((diagnostic) => inPackage(diagnostic.path))
      .map((diagnostic) => ({ path: diagnostic.path.slice(base.length), skipped: { reason: diagnostic.reason, detail: diagnostic.detail } })),
  ].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const files = listed.slice(0, FILE_LIMIT);
  const chosen = files.find((file) => file.path === selected) ?? files.find((file) => file.path === "package.json") ?? files[0];
  if (!chosen) return { files, more: listed.length - files.length, selected: "package.json", content: { skipped: "The package has no committed files." } };
  if (chosen.skipped) return { files, more: listed.length - files.length, selected: chosen.path, content: { skipped: chosen.skipped.detail } };
  const result = await reader.read(`${base}${chosen.path}`);
  const content = result?.ok ? (result.content.text === null ? { skipped: "Binary content isn't shown." } : { text: result.content.text }) : { skipped: result?.skip.detail ?? "It couldn't be read." };
  return { files, more: listed.length - files.length, selected: chosen.path, content };
}
