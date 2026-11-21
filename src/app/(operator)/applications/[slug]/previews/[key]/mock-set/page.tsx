import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FormTemplate } from "@/components/templates/form-template";
import { findSavedPreview } from "@/lib/applications/saved-previews";
import { getDb } from "@/lib/db/client";
import { applicationDefault, previewDefault, savedPreviewId } from "@/lib/mocks/defaults";
import { listSets } from "@/lib/mocks/records";
import { routes } from "@/lib/web/routes";
import { previewSetAction } from "../../../mock-sets/actions";
import { pageApplication } from "../../../mock-sets/shared";
import { PreviewSetForm } from "./preview-set-form";

export const metadata: Metadata = { title: "Mock set for a saved preview" };

/**
 * A saved preview's mock set (add-mock-sets, design decision 18;
 * saved-previews spec, "A saved preview can choose its own default mock
 * set"), on the Form template: the application's default, None, or one of
 * the application's sets, which applies to its views no visitor chose for,
 * and to its screenshots. It works without JavaScript.
 */
export default async function SavedPreviewMockSetPage({ params }: PageProps<"/applications/[slug]/previews/[key]/mock-set">) {
  const { slug, key } = await params;
  const application = pageApplication(slug);
  const saved = findSavedPreview(getDb(), application.publicId, key);
  if (!saved) notFound();
  const previewId = savedPreviewId(getDb(), saved.publicId);
  const own = previewDefault(getDb(), application.id, previewId);
  const fallback = applicationDefault(getDb(), application.id);
  const choice = own.kind === "set" ? own.set.publicId : own.kind;
  return (
    <FormTemplate
      header={{
        breadcrumbs: [
          { href: routes.applications, label: "Applications" },
          { href: routes.application(slug), label: application.name },
        ],
        title: `Mock set for ${saved.label}`,
        description: `The mock set ${saved.label}'s views apply when no visitor chose one, and its screenshots.`,
      }}
    >
      <PreviewSetForm
        action={previewSetAction.bind(null, slug, key)}
        initial={{ values: { choice }, errors: {} }}
        choices={[
          { value: "inherit", label: fallback ? `Application default (${fallback.name})` : "Application default (none)", description: "It follows when the application's default changes." },
          { value: "none", label: "None", description: "The application's own network, even when the application has a default." },
          ...listSets(getDb(), application.id).map((set) => ({ value: set.publicId, label: set.name, description: set.description ?? undefined })),
        ]}
        cancelHref={routes.application(slug)}
      />
    </FormTemplate>
  );
}
