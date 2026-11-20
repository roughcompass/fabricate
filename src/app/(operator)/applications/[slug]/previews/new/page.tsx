import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FormTemplate } from "@/components/templates/form-template";
import { Alert } from "@/components/ui/alert";
import { requireApplications } from "@/lib/applications/availability";
import { refChoices, remoteRefs } from "@/lib/applications/preview-mode";
import { findApplication } from "@/lib/applications/records";
import { savedPreviewsOf } from "@/lib/applications/saved-previews";
import { getDb } from "@/lib/db/client";
import { param } from "@/lib/web/query";
import { routes } from "@/lib/web/routes";
import { RefFinder, refOptions, remainingPreviews } from "../../ref-choice";
import { createPreviewAction } from "./actions";
import { NewPreviewForm } from "./preview-form";

export async function generateMetadata({ params }: PageProps<"/applications/[slug]/previews/new">): Promise<Metadata> {
  const application = findApplication(getDb(), (await params).slug);
  return { title: application ? `New preview · ${application.name}` : "Application not found" };
}

/**
 * New preview (applications/saved-previews spec, "Saved previews are created
 * from the application page or preview mode"; design decision 12), on the
 * Form template: breadcrumbs back to Applications and the application, the
 * branch or tag choice and its search as preview mode has them, and Cancel
 * and Create preview. `?ref=` chooses a branch or tag, and `?find=` searches
 * the ones the choice leaves out. It works without JavaScript.
 */
export default async function NewPreviewPage({ params, searchParams }: PageProps<"/applications/[slug]/previews/new">) {
  requireApplications();
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const application = findApplication(getDb(), slug);
  if (!application) notFound();
  const listing = await remoteRefs(application, getDb());
  const saved = savedPreviewsOf(getDb(), application.publicId);
  const ref = param(query, "ref") ?? null;
  const find = param(query, "find")?.trim().slice(0, 100) || null;
  const choices = refChoices(application, listing, { find, selected: ref, saved });
  const unlisted = [choices.tracked, ...saved.map((preview) => preview.ref)];
  const first = choices.branches[0]?.name ?? choices.tags[0]?.name ?? choices.tracked;
  const defaultRef = ref && (unlisted.includes(ref) || [...choices.branches, ...choices.tags].some((choice) => choice.name === ref)) ? ref : first;
  const here = routes.newApplicationPreview(slug);

  return (
    <FormTemplate
      header={{
        breadcrumbs: [
          { href: routes.applications, label: "Applications" },
          { href: routes.application(slug), label: application.name },
        ],
        title: "New preview",
        description: `Keep a branch or tag of ${application.repository.name} built beside ${application.trackedBranch}, so you can open it in preview mode or full screen, and share it.`,
      }}
      alerts={
        listing.unavailable ? (
          <Alert tone="warning" title="The remote's branches and tags couldn't be listed">
            {`${listing.unavailable} Check that the remote is reachable, then reload the page.`}
          </Alert>
        ) : undefined
      }
    >
      <RefFinder action={here} hidden={{ ref: defaultRef }} choices={choices} clearHref={routes.newApplicationPreview(slug, { ref: defaultRef })} />
      <NewPreviewForm action={createPreviewAction.bind(null, slug)} options={refOptions(choices)} defaultRef={defaultRef} remaining={remainingPreviews(saved.length)} cancelHref={routes.application(slug)} />
    </FormTemplate>
  );
}
