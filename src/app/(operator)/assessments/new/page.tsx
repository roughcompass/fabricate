import type { Metadata } from "next";
import { FormTemplate } from "@/components/templates/form-template";
import { listRepositories } from "@/lib/repositories/repository-records";
import { getDb } from "@/lib/db/client";
import { createAssessment } from "../actions";
import { releaseChoices, repositoryChoices } from "../choices";
import { AssessmentForm } from "../assessment-form";

export const metadata: Metadata = { title: "New Assessment" };

export default function NewAssessmentPage() {
  const db = getDb();
  return (
    <FormTemplate
      header={{
        breadcrumbs: [{ href: "/assessments", label: "Assessments" }],
        title: "New Assessment",
        description: "Choose which repositories to assess and, optionally, which published Releases to evaluate them against.",
      }}
    >
      <AssessmentForm
        action={createAssessment}
        initial={{ values: { name: "", objective: "", selectionMode: "all", repositoryPublicIds: [], standardReleasePublicIds: [] }, errors: {} }}
        repositoryCount={listRepositories(db).length}
        repositoryChoices={repositoryChoices(db)}
        releaseChoices={releaseChoices(db)}
        submitLabel="Create Assessment"
        cancelHref="/"
      />
    </FormTemplate>
  );
}
