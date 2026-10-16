import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AiNotice } from "@/components/prototypes/ai-notice";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Page, PageHeader } from "@/components/ui/page";
import { NotFoundError } from "@/lib/db/errors";
import { isPublicId } from "@/lib/db/ids";
import { type Persona, getPersona } from "@/lib/prototypes/personas";
import { prototypesRequest } from "@/lib/prototypes/request";
import { deletePersonaAction, updatePersonaAction } from "../actions";
import { PersonaForm } from "../persona-form";

async function load(personaId: string): Promise<Persona> {
  if (!isPublicId(personaId, "per")) notFound();
  const { db, workspace } = await prototypesRequest();
  try {
    return await getPersona(db, workspace.id, personaId);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ personaId: string }> }): Promise<Metadata> {
  const { personaId } = await params;
  if (!isPublicId(personaId, "per")) return { title: "Persona not found" };
  const { db, workspace } = await prototypesRequest();
  const persona = await getPersona(db, workspace.id, personaId).catch(() => null);
  return { title: persona ? `${persona.name} · Personas` : "Persona not found" };
}

/** Editing a persona leaves the versions already generated for it unchanged (personas spec, "Editing after generation"). */
export default async function PersonaPage({ params }: { params: Promise<{ personaId: string }> }) {
  const persona = await load((await params).personaId);
  return (
    <Page width="form">
      <PageHeader
        breadcrumbs={[{ href: "/prototypes/personas", label: "Personas" }]}
        title={persona.name}
        description="Changes apply to generations from now on; versions generated earlier keep the details they were generated with."
        extraActions={
          <ConfirmDialog action={deletePersonaAction} fields={{ persona: persona.id }} trigger={{ label: "Delete persona", icon: "trash", variant: "danger" }} title={`Delete ${persona.name}?`} confirmLabel="Delete persona" tone="danger">
            They are no longer offered in New prototype. Prototypes already generated for them keep their copy of these details.
          </ConfirmDialog>
        }
      />
      <AiNotice confidential />
      <PersonaForm
        action={updatePersonaAction.bind(null, persona.id)}
        initial={{
          values: { name: persona.name, role: persona.role, organizationType: persona.organizationType, goals: persona.goals.join("\n"), context: persona.context, constraints: persona.constraints.join("\n"), distinction: persona.distinction ?? "" },
          errors: {},
        }}
        submitLabel="Save persona"
      />
    </Page>
  );
}
