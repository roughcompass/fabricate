import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { entryPath } from "@/lib/applications/microfrontends";
import { findSavedPreview } from "@/lib/applications/saved-previews";
import { findApplication } from "@/lib/applications/records";
import type { FrontendRegistryConfig } from "@/lib/config";
import type { Executor } from "@/lib/db/client";
import { previewBuilds } from "@/lib/db/schema";
import { sharedSetGoneNotice } from "@/lib/mocks/active";
import { findSet } from "@/lib/mocks/records";
import { openPreview } from "@/lib/previews/access";
import { type SessionPreset, findPreset } from "./presets";
import type { ShareView } from "./shares";

/*
 * What a share link applies besides its build and route
 * (restore-toolbar-tools-and-branch-previews, design decision 5): the
 * sharer's Salt theme, their Microfrontends routing, which registers the
 * routing worker in the recipient's browser, and the session preset they
 * chose, applied with its current entries for the shared view only, so the
 * recipient's own choice stays as it is. A routing target that's gone is
 * dropped, and a preset that was deleted is skipped, each with a notice.
 *
 * The mock set the link names applies to the shared view only, with its
 * current rules, through the view's worker; the page resolves it with the
 * view's active set (src/lib/mocks/active.ts). A set that was deleted adds
 * a notice, and the view uses the recipient's own choice (add-mock-sets,
 * design decision 17).
 */

/** A microfrontend the link routes, with the build it's routed to, as Microfrontends shows it. */
export interface SharedRoute {
  readonly id: string;
  readonly name: string;
  readonly mechanism: "module-federation" | "import-map";
  readonly from: string;
  /** The same file in the routed build, from the Frontend Registry's root: `/previews/<build>/remoteEntry.js`. */
  readonly to: string;
  readonly target: { readonly application: string; readonly slug: string; readonly preview: string | null; readonly label: string; readonly commit: string; readonly build: string };
}

export interface OpenedView {
  readonly theme: ShareView["theme"] | null;
  readonly routing: readonly SharedRoute[];
  /** The named preset, with its entries as they stand now. */
  readonly session: SessionPreset | null;
  /** Why some of what the link captured doesn't apply. */
  readonly notices: readonly string[];
}

/** The build +build+'s commit, while it's served. */
function servedCommit(db: Executor, config: FrontendRegistryConfig, build: string): string | null {
  const row = db
    .select({ commitSha: previewBuilds.commitSha })
    .from(previewBuilds)
    .where(and(eq(previewBuilds.publicId, build), isNull(previewBuilds.deletedAt), isNotNull(previewBuilds.artifact)))
    .get();
  return row && openPreview(db, config, build) ? row.commitSha : null;
}

/** What the view +view+, captured by a share link of the application +applicationId+, applies as it's opened now. */
export function openView(db: Executor, config: FrontendRegistryConfig, applicationId: number, view: ShareView): OpenedView {
  const notices: string[] = [];
  const routing: SharedRoute[] = [];
  for (const route of view.routing ?? []) {
    const application = findApplication(db, route.target.application);
    const saved = application && route.target.preview ? findSavedPreview(db, application.publicId, route.target.preview) : null;
    const commit = servedCommit(db, config, route.target.build);
    const path = entryPath(route.from);
    if (!application || (route.target.preview && !saved) || !commit || !path) {
      notices.push(`The shared routing of ${route.remote} was dropped, because the build it named is gone.`);
      continue;
    }
    routing.push({
      id: `${route.mechanism === "import-map" ? "import" : "remote"}:${route.remote}`,
      name: route.remote,
      mechanism: route.mechanism,
      from: route.from,
      to: `/previews/${route.target.build}/${path}`,
      target: { application: application.name, slug: application.slug, preview: saved?.key ?? null, label: saved?.label ?? application.trackedBranch, commit, build: route.target.build },
    });
  }
  let session: SessionPreset | null = null;
  if (view.session) {
    session = findPreset(db, applicationId, view.session.preset) ?? null;
    if (!session) notices.push(`The shared preset "${view.session.name}" no longer exists, so this view starts with your own choice.`);
  }
  if (view.mocks?.set && !findSet(db, applicationId, view.mocks.set)) notices.push(sharedSetGoneNotice(view.mocks.name ?? view.mocks.set));
  return { theme: view.theme ?? null, routing, session, notices };
}
