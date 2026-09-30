import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { Page, PageHeader } from "@/components/ui/page";
import { getDb } from "@/lib/db/client";
import { findStandard } from "@/lib/standards/standard-records";
import { updateStandard } from "../../actions";
import { StandardForm } from "../../standard-form";

const loadStandard = cache((publicId: string) => findStandard(getDb(), publicId));

export async function generateMetadata({ params }: { params: Promise<{ standardId: string }> }): Promise<Metadata> {
  const standard = loadStandard((await params).standardId);
  return { title: standard ? `Edit ${standard.name}` : "Standard not found" };
}

export default async function EditStandardPage({ params }: { params: Promise<{ standardId: string }> }) {
  const { standardId } = await params;
  const standard = loadStandard(standardId);
  if (!standard) notFound();

  return (
    <Page width="form">
      <PageHeader
        breadcrumbs={[
          { href: "/standards", label: "Standards" },
          { href: `/standards/${standard.publicId}`, label: standard.name },
        ]}
        title="Edit Standard"
        description="Published Releases keep the name and purpose they were published with."
      />
      <StandardForm
        action={updateStandard.bind(null, standard.publicId)}
        initial={{ values: { name: standard.name, purpose: standard.purpose }, errors: {} }}
        lockVersion={standard.lockVersion}
        submitLabel="Save changes"
        cancelHref={`/standards/${standard.publicId}`}
      />
    </Page>
  );
}
