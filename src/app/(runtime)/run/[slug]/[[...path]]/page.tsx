import { notFound } from "next/navigation";
import { RunningApplication } from "@/components/toolbar/running-application";
import { parseThemeChoice } from "@/components/toolbar/settings/theme";
import { requireApplications } from "@/lib/applications/availability";
import { buildComposition } from "@/lib/applications/composition";
import { findApplication } from "@/lib/applications/records";
import { findSavedPreview } from "@/lib/applications/saved-previews";
import { resolveActiveSet } from "@/lib/mocks/active";
import { listSets } from "@/lib/mocks/records";
import { APPLICATION_STATUS_LABELS } from "@/lib/applications/status";
import { getConfig } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { openSharedView, resolveApplicationView, viewedApplication, viewedPreview } from "@/lib/workspaces/access";
import { type SessionPreset, chosenPreset, listPresets } from "@/lib/workspaces/presets";
import { openView } from "@/lib/workspaces/shared-view";
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
 * captured view"): the saved preview's, for a link to one, or the
 * application's once that preview was removed (openSharedView).
 *
 * `/run/<slug>@<key>/<route>` runs one of the application's saved previews
 * the same way, its current build in place of the application's
 * (applications/saved-previews spec, "A saved preview runs full screen at
 * its own address"), and the toolbar's context row names its branch or tag.
 *
 * The view's mock set, if any, applies before the build loads, through the
 * view's service worker (add-mock-sets, design decision 14).
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
  const preview = saved ? viewedPreview(db, viewed, saved.key) : null;
  const view = resolveApplicationView(db, viewed, workspace, token, preview);
  // A share link opens what it captured, or says why it can't (design decision 5).
  const opened = view.share ? openSharedView(db, getConfig(), application, viewed, view.share) : { saved, build: target.current, notice: null };
  if (!opened) notFound();
  const shown = opened.saved;
  const build = opened.build;
  const base = `/previews/${build.preview}/`;
  // The application's session presets, and the one the visitor's workspace starts it with, which the frame waits for.
  const serialized = (preset: SessionPreset) => ({ ...preset, createdAt: preset.createdAt.toISOString(), updatedAt: preset.updatedAt.toISOString() });
  const presets = listPresets(db, viewed.id).map(serialized);
  const chosen = chosenPreset(db, workspace?.id ?? null, viewed.id)?.publicId ?? null;
  // A share link's theme, routing, and session preset apply to the view it opened (design decision 5).
  const applied = view.share ? openView(db, getConfig(), viewed.id, view.share.view) : null;
  const notice = [opened.notice, ...(applied?.notices ?? [])].filter(Boolean).join(" ") || null;
  // The application's mock sets, and the one this view applies, which the frame waits for (add-mock-sets, design decision 14).
  const sets = listSets(db, viewed.id).map(({ publicId, name, ruleCount, revision, isDefault }) => ({ publicId, name, ruleCount, revision, isDefault }));
  const active = resolveActiveSet(db, { applicationId: viewed.id, previewId: shown ? (viewedPreview(db, viewed, shown.key)?.id ?? null) : null, workspaceId: workspace?.id ?? null });
  return (
    <RunningApplication
      slug={application.slug}
      preview={shown?.key ?? null}
      trackedBranch={application.trackedBranch}
      src={`${base}${path.map(encodeURIComponent).join("/")}${forwarded.size ? `?${forwarded}` : ""}`}
      base={base}
      commit={build.commitSha}
      title={application.name}
      context={{ name: application.name, branch: shown ? shown.label : application.trackedBranch, commit: build.commitSha, status: APPLICATION_STATUS_LABELS[(shown ?? application).status], href: routes.application(application.slug) }}
      share={view.access === "share" ? token : null}
      notice={notice}
      hints={workspace?.hints ?? {}}
      composition={buildComposition(db, build.preview, application.packageDir)}
      session={{ presets, chosen, shared: applied?.session ? serialized(applied.session) : null }}
      shared={applied ? { theme: applied.theme ? parseThemeChoice(applied.theme) : null, routing: applied.routing } : null}
      mocks={{ sets, active: { set: active.set, source: active.source } }}
    />
  );
}
