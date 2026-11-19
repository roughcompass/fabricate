import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SettingsTemplate } from "@/components/templates/settings-template";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { requireApplications } from "@/lib/applications/availability";
import { findApplication } from "@/lib/applications/records";
import { getDb } from "@/lib/db/client";
import { listRemoteRefs } from "@/lib/previews/refs";
import { getRepository } from "@/lib/repositories/repository-records";
import { routes } from "@/lib/web/routes";
import { deleteAction, updateAction } from "../../actions";
import { ApplicationForm } from "../../application-form";
import styles from "../../applications.module.css";

export async function generateMetadata({ params }: PageProps<"/applications/[slug]/settings">): Promise<Metadata> {
  const application = findApplication(getDb(), (await params).slug);
  return { title: application ? `Settings for ${application.name}` : "Application not found" };
}

/**
 * An application's settings (applications/catalog spec, "Applications can
 * be edited and deleted"), on the Settings template: General, its name,
 * description, and tracked branch, from the remote's branches when they can
 * be listed; and the danger section, which deletes it after confirmation.
 */
export default async function ApplicationSettingsPage({ params }: PageProps<"/applications/[slug]/settings">) {
  requireApplications();
  const { slug } = await params;
  const application = findApplication(getDb(), slug);
  if (!application) notFound();
  const listing = await listRemoteRefs(getRepository(getDb(), application.repository.publicId));
  const remote = listing.unavailable ? null : listing.refs.filter((ref) => ref.kind === "branch").map((ref) => ref.label);
  const branches = remote && [application.trackedBranch, ...remote.filter((branch) => branch !== application.trackedBranch)];

  return (
    <SettingsTemplate
      header={{
        breadcrumbs: [
          { href: routes.applications, label: "Applications" },
          { href: routes.application(application.slug), label: application.name },
        ],
        title: `Settings for ${application.name}`,
      }}
      sections={[
        {
          id: "general",
          title: "General",
          description: "Its name, description, and the branch it's built from.",
          content: (
            <ApplicationForm
              action={updateAction.bind(null, application.slug)}
              initial={{ values: { name: application.name, description: application.description, branch: application.trackedBranch }, errors: {} }}
              lockVersion={application.lockVersion}
              branches={branches}
              cancelHref={routes.application(application.slug)}
            />
          ),
        },
      ]}
      danger={{
        description: "Deleting an application can't be undone.",
        content: (
          <div className={styles.dangerRow}>
            <div>
              <p className={styles.dangerTitle}>Delete application</p>
              <p className={styles.traits}>{`Removes ${application.name} from Applications; its builds stay with ${application.repository.name}'s previews.`}</p>
            </div>
            <ConfirmDialog action={deleteAction} fields={{ application: application.slug }} trigger={{ label: "Delete application", icon: "trash", variant: "secondary" }} title={`Delete ${application.name}?`} confirmLabel="Delete application" tone="danger">
              {`${application.name} leaves Applications, with its comments and share links, which stop working. Its builds stay with ${application.repository.name}'s previews until they're pruned, and its remote stays enrolled for previews.`}
            </ConfirmDialog>
          </div>
        ),
      }}
    />
  );
}
