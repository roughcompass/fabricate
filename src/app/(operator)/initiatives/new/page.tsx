import type { Metadata } from "next";
import { Page, PageHeader } from "@/components/ui/page";
import { listSources } from "@/lib/catalog/source-records";
import { getDb } from "@/lib/db/client";
import { createInitiative } from "../actions";
import { releaseChoices, sourceChoices } from "../choices";
import { InitiativeForm } from "../initiative-form";

export const metadata: Metadata = { title: "New Initiative" };

export default function NewInitiativePage() {
  const db = getDb();
  return (
    <Page width="form">
      <PageHeader breadcrumbs={[{ href: "/", label: "Initiatives" }]} title="New Initiative" description="Choose which repositories to assess and, optionally, which published Releases to evaluate them against." />
      <InitiativeForm
        action={createInitiative}
        initial={{ values: { name: "", objective: "", selectionMode: "all_enabled", sourcePublicIds: [], standardReleasePublicIds: [] }, errors: {} }}
        enabledSourceCount={listSources(db, { enabled: true }).length}
        sourceChoices={sourceChoices(db, [])}
        releaseChoices={releaseChoices(db)}
        submitLabel="Create Initiative"
        cancelHref="/"
      />
    </Page>
  );
}
