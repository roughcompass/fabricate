import { notFound } from "next/navigation";
import { RunningApplication } from "@/components/toolbar/running-application";
import { requireApplications } from "@/lib/applications/availability";
import { findApplication } from "@/lib/applications/records";
import { APPLICATION_STATUS_LABELS } from "@/lib/applications/status";
import { getDb } from "@/lib/db/client";
import { referenceTemplate, routeByPath } from "@/lib/demo/catalog";
import { demoEnabled } from "@/lib/demo/guard";
import { routes } from "@/lib/web/routes";

/**
 * A running application at a route of its own (add-applications, design
 * decision 5): the current build's page in a same-origin frame at
 * /previews/<build>/<route>, under the toolbar, outside the operator shell.
 * The address follows the frame's route, so a reload or a share captures it.
 * A template's reference deployment renders from the layout instead, until
 * the template demo is removed; for it this page only rejects routes it
 * doesn't have.
 */
export default async function RunRoute({ params }: PageProps<"/run/[slug]/[[...path]]">) {
  const { slug, path = [] } = await params;
  const template = demoEnabled() ? referenceTemplate(slug) : undefined;
  if (template) {
    if (path.length > 1 || (path.length === 1 && !routeByPath(template.app, path[0]!))) notFound();
    return null;
  }

  requireApplications();
  const application = findApplication(getDb(), slug);
  // An application runs once a build of it has succeeded.
  if (!application?.current) notFound();
  const base = `/previews/${application.current.preview}/`;
  return (
    <RunningApplication
      slug={application.slug}
      src={`${base}${path.map(encodeURIComponent).join("/")}`}
      base={base}
      commit={application.current.commitSha}
      title={application.name}
      context={{ name: application.name, environment: `${application.trackedBranch} · ${application.current.commitSha.slice(0, 12)} · ${APPLICATION_STATUS_LABELS[application.status]}`, href: routes.application(application.slug) }}
      threadsKey={`frontend-registry:threads:${application.publicId}`}
    />
  );
}
