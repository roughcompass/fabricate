"use server";

import { redirect } from "next/navigation";
import { NotFoundError, ValidationError } from "@/lib/db/errors";
import { isPublicId } from "@/lib/db/ids";
import { requirePrototypes } from "@/lib/prototypes/guard";
import { PrototypesLimitError } from "@/lib/prototypes/limits";
import { createPersona, deletePersona, updatePersona } from "@/lib/prototypes/personas";
import { prototypesRequest } from "@/lib/prototypes/request";
import type { PersonaFields } from "@/lib/prototypes/types";
import { errorsFrom, text } from "@/lib/web/form-data";
import type { PersonaFormState, PersonaFormValues } from "./form-state";

function read(formData: FormData): PersonaFormValues {
  return {
    name: text(formData, "name", 200),
    role: text(formData, "role", 300),
    organizationType: text(formData, "organizationType", 300),
    goals: text(formData, "goals", 2_000),
    context: text(formData, "context", 2_000),
    constraints: text(formData, "constraints", 2_000),
    distinction: text(formData, "distinction", 600),
  };
}

const lines = (value: string) => value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

function fields(values: PersonaFormValues): PersonaFields {
  return { ...values, goals: lines(values.goals), constraints: lines(values.constraints), distinction: values.distinction || null };
}

export async function createPersonaAction(_previous: PersonaFormState, formData: FormData): Promise<PersonaFormState> {
  requirePrototypes();
  const values = read(formData);
  const { db, workspace } = await prototypesRequest();
  let id: string;
  try {
    id = (await createPersona(db, workspace.id, fields(values))).id;
  } catch (error) {
    if (error instanceof ValidationError) return { values, errors: errorsFrom(error) };
    if (error instanceof PrototypesLimitError) return { values, errors: { base: [error.message] } };
    throw error;
  }
  redirect(`/prototypes/personas?notice=created&persona=${id}`);
}

export async function updatePersonaAction(personaId: string, _previous: PersonaFormState, formData: FormData): Promise<PersonaFormState> {
  requirePrototypes();
  if (!isPublicId(personaId, "per")) throw new NotFoundError("Unknown persona");
  const values = read(formData);
  const { db, workspace } = await prototypesRequest();
  try {
    await updatePersona(db, workspace.id, personaId, fields(values));
  } catch (error) {
    if (error instanceof ValidationError) return { values, errors: errorsFrom(error) };
    throw error;
  }
  redirect(`/prototypes/personas?notice=updated&persona=${personaId}`);
}

export async function deletePersonaAction(formData: FormData): Promise<void> {
  requirePrototypes();
  const personaId = text(formData, "persona", 40);
  if (!isPublicId(personaId, "per")) throw new NotFoundError("Unknown persona");
  const { db, workspace } = await prototypesRequest();
  await deletePersona(db, workspace.id, personaId);
  redirect("/prototypes/personas?notice=deleted");
}
