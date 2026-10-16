import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Page, PageHeader } from "@/components/ui/page";
import { applicationHref, findApplication } from "@/lib/applications/applications";
import { getDb } from "@/lib/db/client";
import { portals, repositorySources } from "@/lib/db/schema";
import { editApplicationAction } from "../actions";
import { ApplicationEditForm } from "./edit-form";

function registered(applicationId: string) {
  const application = findApplication(getDb(), applicationId);
  return application?.name && application.slug && application.repositorySourceId !== null && application.portalId !== null ? application : null;
}

export async function generateMetadata({ params }: { params: Promise<{ applicationId: string }> }): Promise<Metadata> {
  const application = registered((await params).applicationId);
  return { title: application ? `Edit details · ${application.name}` : "Application not found" };
}

/** An Application's Edit details form, opened from its dashboard's overflow menu. */
export default async function EditApplicationPage({ params }: { params: Promise<{ applicationId: string }> }) {
  const application = registered((await params).applicationId);
  if (!application) notFound();
  const db = getDb();
  const repository = db.select({ cloneUrl: repositorySources.cloneUrl }).from(repositorySources).where(eq(repositorySources.id, application.repositorySourceId!)).get()!;
  const portal = db.select({ label: portals.label }).from(portals).where(eq(portals.id, application.portalId!)).get()!;
  const dashboard = applicationHref(application.publicId);
  return (
    <Page width="form">
      <PageHeader
        breadcrumbs={[
          { href: "/applications", label: "Applications" },
          { href: dashboard, label: application.name! },
        ]}
        title="Edit details"
      />
      <ApplicationEditForm
        action={editApplicationAction.bind(null, application.publicId)}
        initial={{ values: { name: application.name!, sealId: application.sealId ?? "", description: application.description ?? "" }, errors: {} }}
        lockVersion={application.lockVersion}
        cancelHref={dashboard}
        fixed={{ slug: application.slug!, repository: repository.cloneUrl, portal: portal.label }}
      />
    </Page>
  );
}
