import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { Page, PageHeader } from "@/components/ui/page";
import Link from "next/link";
import { findSource, owningApplication } from "@/lib/catalog/source-records";
import { getDb } from "@/lib/db/client";
import { updateSource } from "../../actions";
import { SourceForm } from "../../source-form";

const loadSource = cache((publicId: string) => findSource(getDb(), publicId));

export async function generateMetadata({ params }: { params: Promise<{ sourceId: string }> }): Promise<Metadata> {
  const source = loadSource((await params).sourceId);
  return { title: source ? `Edit ${source.name}` : "Repository not found" };
}

export default async function EditSourcePage({ params }: { params: Promise<{ sourceId: string }> }) {
  const { sourceId } = await params;
  const source = loadSource(sourceId);
  if (!source) notFound();
  const application = owningApplication(getDb(), source.id);

  return (
    <Page width="form">
      <PageHeader
        breadcrumbs={[{ href: "/repositories", label: "Repositories" }]}
        title="Edit Repository"
        meta={[
          source.name,
          ...(application
            ? [
                <span key="application">
                  Application <Link href={`/applications/${application.publicId}`}>{application.name}</Link>
                </span>,
              ]
            : []),
        ]}
        description="Changes apply to Runs started afterward."
      />
      <SourceForm
        action={updateSource.bind(null, source.publicId)}
        initial={{ values: { name: source.name, cloneUrl: source.cloneUrl, gitRef: source.gitRef ?? "" }, errors: {} }}
        lockVersion={source.lockVersion}
        submitLabel="Save changes"
        application={application}
      />
    </Page>
  );
}
