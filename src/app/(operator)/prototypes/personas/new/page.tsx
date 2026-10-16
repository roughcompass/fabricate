import type { Metadata } from "next";
import { AiNotice } from "@/components/prototypes/ai-notice";
import { Page, PageHeader } from "@/components/ui/page";
import { createPersonaAction } from "../actions";
import { PersonaForm } from "../persona-form";

export const metadata: Metadata = { title: "New persona" };

export default function NewPersonaPage() {
  return (
    <Page width="form">
      <PageHeader breadcrumbs={[{ href: "/prototypes/personas", label: "Personas" }]} title="New persona" description="Who the prototype is for. Name, role, and at least one goal are required." />
      <AiNotice confidential />
      <PersonaForm
        action={createPersonaAction}
        initial={{ values: { name: "", role: "", organizationType: "", goals: "", context: "", constraints: "", distinction: "" }, errors: {} }}
        submitLabel="Create persona"
      />
    </Page>
  );
}
