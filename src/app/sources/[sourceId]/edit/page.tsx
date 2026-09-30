import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Card, Page, PageHeader } from "@/components/ui/layout";
import { findSource } from "@/lib/catalog/source-records";
import { getDb } from "@/lib/db/client";
import { updateSource } from "../../actions";
import { SourceForm } from "../../source-form";

export const metadata: Metadata = { title: "Edit source" };

export default async function EditSourcePage({ params }: { params: Promise<{ sourceId: string }> }) {
  const { sourceId } = await params;
  const source = findSource(getDb(), sourceId);
  if (!source) notFound();

  return (
    <Page width="narrow">
      <PageHeader
        title={`Edit ${source.name}`}
        back={{ href: "/sources", label: "Sources" }}
        description="Changes apply to assessments started afterward. Running and past assessments keep the configuration they started with."
      />
      <Card>
        <SourceForm
          action={updateSource.bind(null, source.publicId)}
          initial={{ values: { name: source.name, cloneUrl: source.cloneUrl, gitRef: source.gitRef ?? "" }, errors: {} }}
          lockVersion={source.lockVersion}
          submitLabel="Save changes"
        />
      </Card>
    </Page>
  );
}
