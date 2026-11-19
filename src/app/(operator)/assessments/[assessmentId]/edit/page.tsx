import type { Metadata } from "next";
import { FormTemplate } from "@/components/templates/form-template";
import { notFound } from "next/navigation";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Panel } from "@/components/ui/panel";
import { listRuns } from "@/lib/runs/run-records";
import { listRepositories } from "@/lib/repositories/repository-records";
import { getDb } from "@/lib/db/client";
import { selectedReleases, selectedRepositories } from "@/lib/assessments/assessment-records";
import { deleteAssessment, updateAssessment } from "../../actions";
import { releaseChoices, repositoryChoices } from "../../choices";
import { AssessmentForm } from "../../assessment-form";
import { routes } from "@/lib/web/routes";
import { loadAssessment } from "../load";

export async function generateMetadata({ params }: PageProps<"/assessments/[assessmentId]/edit">): Promise<Metadata> {
  const assessment = loadAssessment((await params).assessmentId);
  return { title: assessment ? `Edit ${assessment.name}` : "Assessment not found" };
}

export default async function EditAssessmentPage({ params }: PageProps<"/assessments/[assessmentId]/edit">) {
  const { assessmentId } = await params;
  const db = getDb();
  const assessment = loadAssessment(assessmentId);
  if (!assessment) notFound();

  const repositoryIds = selectedRepositories(db, assessment.id).map((repository) => repository.publicId);
  const releaseIds = selectedReleases(db, assessment.id).map(({ release }) => release.publicId);
  const assessed = listRuns(db, assessment.id).length > 0;

  return (
    <FormTemplate
      header={{
        breadcrumbs: [
          { href: "/assessments", label: "Assessments" },
          { href: routes.assessment(assessment.publicId), label: assessment.name },
        ],
        title: `Edit ${assessment.name}`,
        description: "Changes apply to future Runs and Evaluations only.",
      }}
    >
      <AssessmentForm
        action={updateAssessment.bind(null, assessment.publicId)}
        initial={{
          values: { name: assessment.name, objective: assessment.objective, selectionMode: assessment.selectionMode, repositoryPublicIds: repositoryIds, standardReleasePublicIds: releaseIds },
          errors: {},
        }}
        lockVersion={assessment.lockVersion}
        repositoryCount={listRepositories(db).length}
        repositoryChoices={repositoryChoices(db)}
        releaseChoices={releaseChoices(db)}
        submitLabel="Save changes"
        cancelHref={routes.assessment(assessment.publicId)}
      />
      {!assessed && (
        <Panel
          title="Delete Assessment"
          description="Only an Assessment without Runs can be deleted."
          tone="danger"
          footer={
            <ConfirmDialog
              action={deleteAssessment}
              fields={{ publicId: assessment.publicId }}
              trigger={{ label: "Delete Assessment", icon: "trash", variant: "danger" }}
              title={`Delete ${assessment.name}?`}
              confirmLabel="Delete Assessment"
              tone="danger"
            >
              <p>This cannot be undone.</p>
            </ConfirmDialog>
          }
        />
      )}
    </FormTemplate>
  );
}
