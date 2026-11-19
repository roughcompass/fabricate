import { FocusedHeader } from "@/components/shell/focused-header";
import { ShellHeader } from "@/components/shell/shell-header";
import { applicationsAvailable } from "@/lib/applications/availability";
import { findApplication } from "@/lib/applications/records";
import { getDb } from "@/lib/db/client";
import { routes } from "@/lib/web/routes";

/** Preview mode's shell header: Back to the application, in place of the sidebar controls (template-preview spec). */
export default async function ApplicationPreviewHeader({ params }: PageProps<"/applications/[slug]/preview">) {
  const { slug } = await params;
  const application = applicationsAvailable() ? findApplication(getDb(), slug) : undefined;
  if (!application) return <ShellHeader />;
  return <FocusedHeader path={routes.applicationPreview(application.slug)} focused={<ShellHeader back={{ href: routes.application(application.slug), label: `Back to ${application.name}` }} />} shell={<ShellHeader />} />;
}
