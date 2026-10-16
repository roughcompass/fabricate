import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Page, PageHeader } from "@/components/ui/page";
import { Panel } from "@/components/ui/panel";
import { listAssessments } from "@/lib/assessments/assessment-records";
import { listSources } from "@/lib/catalog/source-records";
import { getDb } from "@/lib/db/client";
import { findInitiative, isSystemOwned, selectedReleases, selectedSources } from "@/lib/initiatives/initiative-records";
import { deleteInitiative, updateInitiative, updateReleaseSelections } from "../../actions";
import { releaseChoices, sourceChoices } from "../../choices";
import { InitiativeForm } from "../../initiative-form";
import { ReleaseSelectionForm } from "../../release-selection-form";

const loadInitiative = cache((publicId: string) => findInitiative(getDb(), publicId));

export async function generateMetadata({ params }: { params: Promise<{ initiativeId: string }> }): Promise<Metadata> {
  const initiative = loadInitiative((await params).initiativeId);
  return { title: initiative ? (initiative.systemOwned ? `Releases · ${initiative.name}` : `Edit ${initiative.name}`) : "Assessment not found" };
}

export default async function EditInitiativePage({ params }: { params: Promise<{ initiativeId: string }> }) {
  const { initiativeId } = await params;
  const db = getDb();
  const initiative = loadInitiative(initiativeId);
  if (!initiative) notFound();

  const sourceIds = selectedSources(db, initiative.id).map((source) => source.publicId);
  const releaseIds = selectedReleases(db, initiative.id).map(({ release }) => release.publicId);
  const assessed = listAssessments(db, initiative.id).length > 0;

  // Salt Patterns: DE FabLab owns its name, objective, and template targets; only its Releases are chosen here.
  if (initiative.systemOwned) {
    return (
      <Page width="form">
        <PageHeader
          breadcrumbs={[
            { href: "/assessments", label: "Assessments" },
            { href: `/assessments/${initiative.publicId}`, label: initiative.name },
          ]}
          title="Select Releases"
          description="Changes apply to template versions accepted or re-checked from now on."
        />
        <ReleaseSelectionForm
          action={updateReleaseSelections.bind(null, initiative.publicId)}
          initial={{ values: { standardReleasePublicIds: releaseIds }, errors: {} }}
          lockVersion={initiative.lockVersion}
          releaseChoices={releaseChoices(db)}
          cancelHref={`/assessments/${initiative.publicId}`}
        />
      </Page>
    );
  }

  return (
    <Page width="form">
      <PageHeader
        breadcrumbs={[
          { href: "/assessments", label: "Assessments" },
          { href: `/assessments/${initiative.publicId}`, label: initiative.name },
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
        enabledSourceCount={listSources(db, { enabled: true }).length}
        sourceChoices={sourceChoices(db, sourceIds)}
        releaseChoices={releaseChoices(db)}
        submitLabel="Save changes"
        cancelHref={`/assessments/${initiative.publicId}`}
      />
      {!assessed && !isSystemOwned(initiative) && (
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
