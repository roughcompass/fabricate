import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { Card, Page, PageHeader } from "@/components/ui/layout";
import { listAssessments } from "@/lib/assessments/assessment-records";
import { listSources } from "@/lib/catalog/source-records";
import { getDb } from "@/lib/db/client";
import { findInitiative, selectedReleases, selectedSources } from "@/lib/initiatives/initiative-records";
import { deleteInitiative, updateInitiative } from "../../actions";
import { releaseChoices, sourceChoices } from "../../choices";
import { InitiativeForm } from "../../initiative-form";

export const metadata: Metadata = { title: "Edit initiative" };

export default async function EditInitiativePage({ params }: { params: Promise<{ initiativeId: string }> }) {
  const { initiativeId } = await params;
  const db = getDb();
  const initiative = findInitiative(db, initiativeId);
  if (!initiative) notFound();

  const sourceIds = selectedSources(db, initiative.id).map((source) => source.publicId);
  const releaseIds = selectedReleases(db, initiative.id).map(({ release }) => release.publicId);
  const assessed = listAssessments(db, initiative.id).length > 0;

  return (
    <Page width="settings">
      <PageHeader
        title={`Edit ${initiative.name}`}
        back={{ href: `/initiatives/${initiative.publicId}`, label: initiative.name }}
        description="Changes apply to future Assessments and Evaluations only."
      />
      <Card>
        <InitiativeForm
          action={updateInitiative.bind(null, initiative.publicId)}
          initial={{
            values: { name: initiative.name, objective: initiative.objective, selectionMode: initiative.selectionMode, sourcePublicIds: sourceIds, standardReleasePublicIds: releaseIds },
            errors: {},
          }}
          lockVersion={initiative.lockVersion}
          enabledSourceCount={listSources(db, { enabled: true }).length}
          sourceChoices={sourceChoices(db, sourceIds)}
          releaseChoices={releaseChoices(db)}
          submitLabel="Save changes"
          cancelHref={`/initiatives/${initiative.publicId}`}
        />
      </Card>
      {!assessed && (
        <Card title="Delete initiative" description="Only initiatives without Assessments can be deleted. This cannot be undone.">
          <div>
            <ConfirmButton action={deleteInitiative} fields={{ publicId: initiative.publicId }} icon="trash" confirmation={`Delete ${initiative.name}? This cannot be undone.`}>
              Delete initiative
            </ConfirmButton>
          </div>
        </Card>
      )}
    </Page>
  );
}
