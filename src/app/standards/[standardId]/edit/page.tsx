import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Card, Page, PageHeader } from "@/components/ui/layout";
import { getDb } from "@/lib/db/client";
import { findStandard } from "@/lib/standards/standard-records";
import { updateStandard } from "../../actions";
import { StandardForm } from "../../standard-form";

export const metadata: Metadata = { title: "Edit Standard" };

export default async function EditStandardPage({ params }: { params: Promise<{ standardId: string }> }) {
  const { standardId } = await params;
  const standard = findStandard(getDb(), standardId);
  if (!standard) notFound();

  return (
    <Page width="narrow">
      <PageHeader title={`Edit ${standard.name}`} back={{ href: `/standards/${standard.publicId}`, label: standard.name }} description="Published Releases keep the name and purpose they were published with." />
      <Card>
        <StandardForm
          action={updateStandard.bind(null, standard.publicId)}
          initial={{ values: { name: standard.name, purpose: standard.purpose }, errors: {} }}
          lockVersion={standard.lockVersion}
          submitLabel="Save"
          cancelHref={`/standards/${standard.publicId}`}
        />
      </Card>
    </Page>
  );
}
