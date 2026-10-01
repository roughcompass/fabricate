import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { Page, PageHeader } from "@/components/ui/page";
import { findSource } from "@/lib/catalog/source-records";
import { getDb } from "@/lib/db/client";
import { updateSource } from "../../actions";
import { SourceForm } from "../../source-form";

const loadSource = cache((publicId: string) => findSource(getDb(), publicId));

export async function generateMetadata({ params }: { params: Promise<{ sourceId: string }> }): Promise<Metadata> {
  const source = loadSource((await params).sourceId);
  return { title: source ? `Edit ${source.name}` : "Source not found" };
}

export default async function EditSourcePage({ params }: { params: Promise<{ sourceId: string }> }) {
  const { sourceId } = await params;
  const source = loadSource(sourceId);
  if (!source) notFound();

  return (
    <Page width="form">
      <PageHeader
        breadcrumbs={[{ href: "/sources", label: "Sources" }]}
        title="Edit Source"
        meta={[source.name]}
        description="Changes apply to Assessments started afterward."
      />
      <SourceForm
        action={updateSource.bind(null, source.publicId)}
        initial={{ values: { name: source.name, cloneUrl: source.cloneUrl, gitRef: source.gitRef ?? "" }, errors: {} }}
        lockVersion={source.lockVersion}
        submitLabel="Save changes"
      />
    </Page>
  );
}
