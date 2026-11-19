import type { Metadata } from "next";
import { FormTemplate } from "@/components/templates/form-template";
import { notFound } from "next/navigation";
import { updateStandard } from "../../actions";
import { StandardForm } from "../../standard-form";
import { routes } from "@/lib/web/routes";
import { loadStandard } from "../load";

export async function generateMetadata({ params }: PageProps<"/standards/[standardId]/edit">): Promise<Metadata> {
  const standard = loadStandard((await params).standardId);
  return { title: standard ? `Edit ${standard.name}` : "Standard not found" };
}

export default async function EditStandardPage({ params }: PageProps<"/standards/[standardId]/edit">) {
  const { standardId } = await params;
  const standard = loadStandard(standardId);
  if (!standard) notFound();

  return (
    <FormTemplate
      header={{
        breadcrumbs: [
          { href: "/standards", label: "Standards" },
          { href: routes.standard(standard.publicId), label: standard.name },
        ],
        title: `Edit ${standard.name}`,
        description: "Published Releases keep the name and purpose they were published with.",
      }}
    >
      <StandardForm
        action={updateStandard.bind(null, standard.publicId)}
        initial={{ values: { name: standard.name, purpose: standard.purpose }, errors: {} }}
        lockVersion={standard.lockVersion}
        submitLabel="Save changes"
        cancelHref={routes.standard(standard.publicId)}
      />
    </FormTemplate>
  );
}
