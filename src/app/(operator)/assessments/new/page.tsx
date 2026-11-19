import type { Metadata } from "next";
import { Page, PageHeader } from "@/components/ui/page";
import { listSources } from "@/lib/catalog/source-records";
import { getDb } from "@/lib/db/client";
import { createAssessment } from "../actions";
import { releaseChoices, sourceChoices } from "../choices";
import { AssessmentForm } from "../assessment-form";

export const metadata: Metadata = { title: "New Assessment" };

export default function NewAssessmentPage() {
  const db = getDb();
  return (
    <Page width="form">
      <PageHeader breadcrumbs={[{ href: "/assessments", label: "Assessments" }]} title="New Assessment" description="Choose which repositories to assess and, optionally, which published Releases to evaluate them against." />
      <AssessmentForm
        action={createAssessment}
        initial={{ values: { name: "", objective: "", selectionMode: "all", sourcePublicIds: [], standardReleasePublicIds: [] }, errors: {} }}
        sourceCount={listSources(db).length}
        sourceChoices={sourceChoices(db)}
        releaseChoices={releaseChoices(db)}
        submitLabel="Create Assessment"
        cancelHref="/"
      />
    </Page>
  );
}
