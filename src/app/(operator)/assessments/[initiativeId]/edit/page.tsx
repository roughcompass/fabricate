import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Page, PageHeader } from "@/components/ui/page";
import { Panel } from "@/components/ui/panel";
import { listAssessments } from "@/lib/assessments/assessment-records";
import { listSources } from "@/lib/catalog/source-records";
import { getDb } from "@/lib/db/client";
import { selectedReleases, selectedSources } from "@/lib/initiatives/initiative-records";
import { deleteInitiative, updateInitiative } from "../../actions";
import { releaseChoices, sourceChoices } from "../../choices";
import { InitiativeForm } from "../../initiative-form";
import { routes } from "@/lib/web/routes";
import { loadAssessment } from "../load";

export async function generateMetadata({ params }: PageProps<"/assessments/[initiativeId]/edit">): Promise<Metadata> {
  const initiative = loadAssessment((await params).initiativeId);
  return { title: initiative ? `Edit ${initiative.name}` : "Assessment not found" };
}

export default async function EditInitiativePage({ params }: PageProps<"/assessments/[initiativeId]/edit">) {
  const { initiativeId } = await params;
  const db = getDb();
  const initiative = loadAssessment(initiativeId);
  if (!initiative) notFound();

  const sourceIds = selectedSources(db, initiative.id).map((source) => source.publicId);
  const releaseIds = selectedReleases(db, initiative.id).map(({ release }) => release.publicId);
  const assessed = listAssessments(db, initiative.id).length > 0;

  return (
    <Page width="form">
      <PageHeader
        breadcrumbs={[
          { href: "/assessments", label: "Assessments" },
          { href: routes.assessment(initiative.publicId), label: initiative.name },
        ]}
        title="Edit Assessment"
        description="Changes apply to future Runs and Evaluations only."
      />
      <InitiativeForm
        action={updateInitiative.bind(null, initiative.publicId)}
        initial={{
          values: { name: initiative.name, objective: initiative.objective, selectionMode: initiative.selectionMode, sourcePublicIds: sourceIds, standardReleasePublicIds: releaseIds },
          errors: {},
        }}
        lockVersion={initiative.lockVersion}
        sourceCount={listSources(db).length}
        sourceChoices={sourceChoices(db)}
        releaseChoices={releaseChoices(db)}
        submitLabel="Save changes"
        cancelHref={routes.assessment(initiative.publicId)}
      />
      {!assessed && (
        <Panel
          title="Delete Assessment"
          description="Only an Assessment without Runs can be deleted."
          tone="danger"
          footer={
            <ConfirmDialog
              action={deleteInitiative}
              fields={{ publicId: initiative.publicId }}
              trigger={{ label: "Delete Assessment", icon: "trash", variant: "danger" }}
              title={`Delete ${initiative.name}?`}
              confirmLabel="Delete Assessment"
              tone="danger"
            >
              <p>This cannot be undone.</p>
            </ConfirmDialog>
          }
        />
      )}
    </Page>
  );
}
