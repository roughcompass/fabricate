import type { Metadata } from "next";
import { Card, Page, PageHeader } from "@/components/ui/layout";
import { listSources } from "@/lib/catalog/source-records";
import { getDb } from "@/lib/db/client";
import { createInitiative } from "../actions";
import { releaseChoices, sourceChoices } from "../choices";
import { InitiativeForm } from "../initiative-form";

export const metadata: Metadata = { title: "New initiative" };

export default function NewInitiativePage() {
  const db = getDb();
  return (
    <Page width="settings">
      <PageHeader
        title="New initiative"
        back={{ href: "/", label: "Initiatives" }}
        description="Choose which repositories to assess and, optionally, which published Standard Releases describe the desired state."
      />
      <Card>
        <InitiativeForm
          action={createInitiative}
          initial={{ values: { name: "", objective: "", selectionMode: "all_enabled", sourcePublicIds: [], standardReleasePublicIds: [] }, errors: {} }}
          enabledSourceCount={listSources(db, { enabled: true }).length}
          sourceChoices={sourceChoices(db, [])}
          releaseChoices={releaseChoices(db)}
          submitLabel="Create initiative"
          cancelHref="/"
        />
      </Card>
    </Page>
  );
}
