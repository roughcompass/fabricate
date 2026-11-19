import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { RunningApplication } from "@/components/toolbar/running-application";
import { getConfig } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { openPreview } from "@/lib/previews/access";
import { e2eRoutesEnabled } from "@/lib/testing/e2e";
import { routes } from "@/lib/web/routes";

export const metadata: Metadata = { title: "Test run", robots: { index: false } };

/**
 * A test page that runs a preview's build under the toolbar, as
 * `/run/<application>` will (add-applications, tasks 8.1 to 8.4): the build's
 * page in a same-origin frame at the route in the address, with the tools
 * that inspect it. It exists only for browser tests, like /api/test/reset, so
 * the toolbar's frame tools can be tested before application records exist;
 * everywhere else it answers not found.
 */
export default async function TestRun({ params }: PageProps<"/test/run/[preview]/[[...path]]">) {
  if (!e2eRoutesEnabled()) notFound();
  const { preview: previewId, path = [] } = await params;
  const open = openPreview(getDb(), getConfig(), previewId);
  if (!open?.preview.artifact) notFound();
  const { preview, repository } = open;
  const base = `/previews/${preview.publicId}/`;
  return (
    <RunningApplication
      src={`${base}${path.map(encodeURIComponent).join("/")}`}
      base={base}
      commit={preview.commitSha}
      title={repository.name}
      context={{ name: repository.name, environment: `${preview.refName ?? "Commit"} · ${preview.commitSha.slice(0, 12)}`, href: routes.repositoryPreview(repository.publicId, preview.publicId) }}
      threadsKey={`frontend-registry:test-run:threads:${repository.publicId}`}
    />
  );
}
