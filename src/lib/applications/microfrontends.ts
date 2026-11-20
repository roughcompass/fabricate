import { inArray } from "drizzle-orm";
import type { FrontendRegistryConfig } from "@/lib/config";
import type { Executor } from "@/lib/db/client";
import { previewBuilds } from "@/lib/db/schema";
import { publishedFileExists } from "@/lib/previews/serving";
import { type BuildComposition, buildComposition } from "./composition";
import { type Application, allApplications } from "./records";
import { savedPreviewsOf } from "./saved-previews";

/*
 * The microfrontends a build composes, each with the builds Microfrontends
 * can route it to (restore-toolbar-tools-and-branch-previews, design
 * decision 7; template-demo/microfrontends spec, "A microfrontend can be
 * routed to another build"). Candidates are only builds the Frontend
 * Registry has: the current build and the saved previews of each
 * application that builds the microfrontend. A Module Federation remote is
 * built by an application whose Profile declares a container of the
 * remote's name that exposes modules, as the Relationship Map matches them;
 * an import-map entry by an application whose package has the specifier's
 * name. Each candidate says whether its build has the file at the entry's
 * path, which routing needs.
 */

export type Mechanism = "module-federation" | "import-map";

/** A build a microfrontend can be routed to. */
export interface CandidateBuild {
  readonly application: { readonly slug: string; readonly name: string };
  /** The saved preview, by its key and ref; null for the application's tracked branch. */
  readonly preview: { readonly key: string; readonly ref: string } | null;
  /** The branch or tag, as it's shown: main, feature/blue-quotes. */
  readonly label: string;
  /** Its current build, or null while it has none, as while its first build runs. */
  readonly build: { readonly preview: string; readonly commit: string } | null;
  /** Whether that build has a file at the entry's path. */
  readonly hasEntry: boolean;
}

export interface Microfrontend {
  /** `remote:<alias>` or `import:<specifier>`. */
  readonly id: string;
  readonly mechanism: Mechanism;
  /** The alias the host imports a remote as, or an import map's specifier. */
  readonly name: string;
  /** The container a remote names, when the Profile resolved it. */
  readonly container: string | null;
  /** Its entry's address as built, or null when code chooses it. */
  readonly entry: string | null;
  /** The entry's path within a build, where routing looks for the same file: `remoteEntry.js`. Null when there's no address to route. */
  readonly entryPath: string | null;
  readonly candidates: readonly CandidateBuild[];
}

/** The path of +entry+'s file within the build that serves it: its address's path, without the leading slash. Null for an address routing can't follow. */
export function entryPath(entry: string | null): string | null {
  if (!entry) return null;
  try {
    const url = new URL(entry, "http://frontend-registry.invalid");
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, "");
    return relative && !relative.endsWith("/") ? relative : null;
  } catch {
    return null;
  }
}

/** Every application with a current build, with what that build is composed of. */
function producers(db: Executor): { application: Application; composition: BuildComposition }[] {
  return allApplications(db).flatMap((application) => (application.current ? [{ application, composition: buildComposition(db, application.current.preview, application.packageDir) }] : []));
}

/** The current build and saved previews of +application+, without whether they have the entry yet. */
function candidatesOf(db: Executor, application: Application): Omit<CandidateBuild, "hasEntry">[] {
  const own = { slug: application.slug, name: application.name };
  return [
    { application: own, preview: null, label: application.trackedBranch, build: application.current && { preview: application.current.preview, commit: application.current.commitSha } },
    ...savedPreviewsOf(db, application.publicId).map((saved) => ({ application: own, preview: { key: saved.key, ref: saved.ref }, label: saved.label, build: saved.current && { preview: saved.current.preview, commit: saved.current.commitSha } })),
  ];
}

/** The microfrontends +composition+ loads, each with its candidate builds. */
export async function microfrontendsOf(db: Executor, config: FrontendRegistryConfig, composition: BuildComposition): Promise<Microfrontend[]> {
  const all = composition.remotes.length || composition.imports.length ? producers(db) : [];
  const listed = [
    ...composition.remotes.map((remote) => ({
      id: `remote:${remote.alias}`,
      mechanism: "module-federation" as const,
      name: remote.alias,
      container: remote.container,
      entry: remote.entry,
      builders: all.filter(({ composition: other }) => other.containers.some((container) => container.name === (remote.container ?? remote.alias))),
    })),
    ...composition.imports.map((entry) => ({ id: `import:${entry.specifier}`, mechanism: "import-map" as const, name: entry.specifier, container: null, entry: entry.url, builders: all.filter(({ composition: other }) => other.packageName === entry.specifier) })),
  ];
  const found = listed.map(({ builders, ...microfrontend }) => ({ microfrontend, candidates: builders.flatMap(({ application }) => candidatesOf(db, application)) }));
  const ids = [...new Set(found.flatMap(({ candidates }) => candidates.flatMap((candidate) => (candidate.build ? [candidate.build.preview] : []))))];
  const rows = ids.length ? db.select({ publicId: previewBuilds.publicId, artifact: previewBuilds.artifact }).from(previewBuilds).where(inArray(previewBuilds.publicId, ids)).all() : [];
  const artifacts = new Map(rows.map((row) => [row.publicId, row]));

  return Promise.all(
    found.map(async ({ microfrontend, candidates }) => {
      const path = entryPath(microfrontend.entry);
      const checked = await Promise.all(
        candidates.map(async (candidate) => {
          const row = candidate.build ? artifacts.get(candidate.build.preview) : undefined;
          return { ...candidate, hasEntry: Boolean(path && row && (await publishedFileExists(config, row, path))) };
        }),
      );
      return { ...microfrontend, entryPath: path, candidates: checked };
    }),
  );
}
