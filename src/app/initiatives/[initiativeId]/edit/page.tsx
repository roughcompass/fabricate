import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Page, PageHeader } from "@/components/ui/page";
import { Panel } from "@/components/ui/panel";
import { listAssessments } from "@/lib/assessments/assessment-records";
import { listSources } from "@/lib/catalog/source-records";
import { getDb } from "@/lib/db/client";
import { findInitiative, selectedReleases, selectedSources } from "@/lib/initiatives/initiative-records";
import { deleteInitiative, updateInitiative } from "../../actions";
import { releaseChoices, sourceChoices } from "../../choices";
import { InitiativeForm } from "../../initiative-form";

const loadInitiative = cache((publicId: string) => findInitiative(getDb(), publicId));

export async function generateMetadata({ params }: { params: Promise<{ initiativeId: string }> }): Promise<Metadata> {
  const initiative = loadInitiative((await params).initiativeId);
  return { title: initiative ? `Edit ${initiative.name}` : "Initiative not found" };
}

export default async function EditInitiativePage({ params }: { params: Promise<{ initiativeId: string }> }) {
  const { initiativeId } = await params;
  const db = getDb();
  const initiative = loadInitiative(initiativeId);
  if (!initiative) notFound();

  const sourceIds = selectedSources(db, initiative.id).map((source) => source.publicId);
  const releaseIds = selectedReleases(db, initiative.id).map(({ release }) => release.publicId);
  const assessed = listAssessments(db, initiative.id).length > 0;

  return (
    <Page width="form">
      <PageHeader
        breadcrumbs={[
          { href: "/", label: "Initiatives" },
          { href: `/initiatives/${initiative.publicId}`, label: initiative.name },
        ]}
        title="Edit Initiative"
        description="Changes apply to future Assessments and Evaluations only."
      />
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
      {!assessed && (
        <Panel
          title="Delete Initiative"
          description="Only an Initiative without Assessments can be deleted."
          tone="danger"
          footer={
            <ConfirmDialog
              action={deleteInitiative}
              fields={{ publicId: initiative.publicId }}
              trigger={{ label: "Delete Initiative", icon: "trash", variant: "danger" }}
              title={`Delete ${initiative.name}?`}
              confirmLabel="Delete Initiative"
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
