import { notFound } from "next/navigation";
import { RunningApplication } from "@/components/toolbar/running-application";
import { requireApplications } from "@/lib/applications/availability";
import { buildComposition } from "@/lib/applications/composition";
import { findApplication } from "@/lib/applications/records";
import { findSavedPreview } from "@/lib/applications/saved-previews";
import { APPLICATION_STATUS_LABELS } from "@/lib/applications/status";
import { getConfig } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { resolveApplicationView, sharedBuild, viewedApplication } from "@/lib/workspaces/access";
import { chosenPreset, listPresets } from "@/lib/workspaces/presets";
import { currentWorkspace } from "@/lib/workspaces/request";
import { param } from "@/lib/web/query";
import { parseRunSegment, routes } from "@/lib/web/routes";

/**
 * A running application at a route of its own (add-applications, design
 * decision 5): a build's page in a same-origin frame at
 * /previews/<build>/<route>, under the toolbar, outside the operator shell.
 * The address follows the frame's route, so a reload or a share captures it.
 *
 * Every query parameter but `share` is the application's own, and goes to
 * its page with the route: `/run/orders/accounts?tab=billing` opens
 * `/accounts?tab=billing`. The build is the current one, or, for a view a
 * share link opened (`?share=<token>`), the build of the commit the link
 * captured, with the sharer's comments. When that build is gone, the current one opens with a
 * notice saying so (template-demo/toolbar spec, "Shared links open the
 * captured view").
 *
 * `/run/<slug>@<key>/<route>` runs one of the application's saved previews
 * the same way, its current build in place of the application's
 * (applications/saved-previews spec, "A saved preview runs full screen at
 * its own address"), and the toolbar's context row names its branch or tag.
 */
export default async function RunRoute({ params, searchParams }: PageProps<"/run/[slug]/[[...path]]">) {
  const { slug: segment, path = [] } = await params;
  requireApplications();
  const { slug, key } = parseRunSegment(segment);
  const db = getDb();
  const application = findApplication(db, slug);
  const viewed = viewedApplication(db, slug);
  const saved = application && key ? (findSavedPreview(db, application.publicId, key) ?? null) : null;
  const target = key ? saved : application;
  // An application, or a saved preview, runs once a build of it has succeeded.
  if (!application || !viewed || !target?.current) notFound();
  const workspace = await currentWorkspace();
  const query = await searchParams;
  const token = param(query, "share") ?? null;
  const forwarded = new URLSearchParams();
  for (const [name, value] of Object.entries(query)) if (name !== "share") for (const each of [value ?? []].flat()) forwarded.append(name, each);
  const view = resolveApplicationView(db, viewed, workspace, token);
  const shared = view.share && view.share.commit !== target.current.commitSha ? sharedBuild(db, getConfig(), viewed, view.share.commit) : null;
  const build = shared ?? target.current;
  const notice = view.share && view.share.commit !== build.commitSha ? `The shared commit ${view.share.commit.slice(0, 12)} is no longer available, so this is the current build.` : null;
  const base = `/previews/${build.preview}/`;
  // The application's session presets, and the one the visitor's workspace starts it with, which the frame waits for.
  const presets = listPresets(db, viewed.id).map((preset) => ({ ...preset, createdAt: preset.createdAt.toISOString(), updatedAt: preset.updatedAt.toISOString() }));
  const chosen = chosenPreset(db, workspace?.id ?? null, viewed.id)?.publicId ?? null;
  return (
    <RunningApplication
      slug={application.slug}
      preview={saved?.key ?? null}
      src={`${base}${path.map(encodeURIComponent).join("/")}${forwarded.size ? `?${forwarded}` : ""}`}
      base={base}
      commit={build.commitSha}
      title={application.name}
      context={{ name: application.name, branch: saved ? saved.label : application.trackedBranch, commit: build.commitSha, status: APPLICATION_STATUS_LABELS[target.status], href: routes.application(application.slug) }}
      share={view.access === "share" ? token : null}
      notice={notice}
      hints={workspace?.hints ?? {}}
      composition={buildComposition(db, build.preview, application.packageDir)}
      session={{ presets, chosen }}
    />
  );
}
