import { notFound } from "next/navigation";
import { RunningApplication } from "@/components/toolbar/running-application";
import { requireApplications } from "@/lib/applications/availability";
import { findApplication } from "@/lib/applications/records";
import { APPLICATION_STATUS_LABELS } from "@/lib/applications/status";
import { getConfig } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { resolveApplicationView, sharedBuild, viewedApplication } from "@/lib/demo/access";
import { referenceTemplate, routeByPath } from "@/lib/demo/catalog";
import { demoEnabled } from "@/lib/demo/guard";
import { currentWorkspace } from "@/lib/demo/request";
import { param } from "@/lib/web/query";
import { routes } from "@/lib/web/routes";

/**
 * A running application at a route of its own (add-applications, design
 * decision 5): a build's page in a same-origin frame at
 * /previews/<build>/<route>, under the toolbar, outside the operator shell.
 * The address follows the frame's route, so a reload or a share captures it.
 *
 * The build is the current one, or, for a view a share link opened
 * (`?share=<token>`), the build of the commit the link captured, with the
 * sharer's comments. When that build is gone, the current one opens with a
 * notice saying so (template-demo/toolbar spec, "Shared links open the
 * captured view").
 *
 * A template's reference deployment renders from the layout instead, until
 * the template demo is removed; for it this page only rejects routes it
 * doesn't have.
 */
export default async function RunRoute({ params, searchParams }: PageProps<"/run/[slug]/[[...path]]">) {
  const { slug, path = [] } = await params;
  const template = demoEnabled() ? referenceTemplate(slug) : undefined;
  if (template) {
    if (path.length > 1 || (path.length === 1 && !routeByPath(template.app, path[0]!))) notFound();
    return null;
  }

  requireApplications();
  const db = getDb();
  const application = findApplication(db, slug);
  const viewed = viewedApplication(db, slug);
  // An application runs once a build of it has succeeded.
  if (!application?.current || !viewed) notFound();
  const workspace = await currentWorkspace();
  const token = param(await searchParams, "share") ?? null;
  const view = resolveApplicationView(db, viewed, workspace, token);
  const shared = view.share && view.share.commit !== application.current.commitSha ? sharedBuild(db, getConfig(), viewed, view.share.commit) : null;
  const build = shared ?? application.current;
  const notice = view.share && view.share.commit !== build.commitSha ? `The shared commit ${view.share.commit.slice(0, 12)} is no longer available, so this is the current build.` : null;
  const base = `/previews/${build.preview}/`;
  return (
    <RunningApplication
      slug={application.slug}
      src={`${base}${path.map(encodeURIComponent).join("/")}`}
      base={base}
      commit={build.commitSha}
      title={application.name}
      context={{ name: application.name, branch: application.trackedBranch, commit: build.commitSha, status: APPLICATION_STATUS_LABELS[application.status], href: routes.application(application.slug) }}
      share={view.access === "share" ? token : null}
      notice={notice}
      hints={workspace?.hints ?? {}}
    />
  );
}
