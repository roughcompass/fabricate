import { and, asc, eq, inArray } from "drizzle-orm";
import { IssueCollector, NotFoundError } from "@/lib/db/errors";
import { generatePublicId } from "@/lib/db/ids";
import type { PrototypesExecutor } from "./db/client";
import { personas } from "./db/schema";
import { PERSONA_LIMIT } from "./limits";
import { MAX_CONSTRAINTS, MAX_GOALS, PERSONA_FIELDS } from "./persona-limits";
import type { PersonaCopy, PersonaFields } from "./types";
import { claimSlot, releaseSlot } from "./workspace";

/**
 * The persona library (prototypes/personas spec). Versions keep a copy of
 * each persona they were generated for, so editing or deleting a persona
 * changes only future choices.
 */

export type Persona = typeof personas.$inferSelect;


/** The persona as a version records it. */
export function copyOf(persona: Persona): PersonaCopy {
  return {
    id: persona.id,
    name: persona.name,
    role: persona.role,
    organizationType: persona.organizationType,
    goals: [...persona.goals],
    context: persona.context,
    constraints: [...persona.constraints],
    distinction: persona.distinction,
  };
}

export async function listPersonas(db: PrototypesExecutor, workspaceId: string): Promise<Persona[]> {
  return db.select().from(personas).where(eq(personas.workspaceId, workspaceId)).orderBy(asc(personas.createdAt), asc(personas.name));
}

export async function getPersona(db: PrototypesExecutor, workspaceId: string, personaId: string): Promise<Persona> {
  const [persona] = await db
    .select()
    .from(personas)
    .where(and(eq(personas.workspaceId, workspaceId), eq(personas.id, personaId)));
  if (!persona) throw new NotFoundError("Unknown persona");
  return persona;
}

/** The workspace's personas with these ids, in the order given; ids that no longer exist are skipped. */
export async function personaCopies(db: PrototypesExecutor, workspaceId: string, ids: readonly string[]): Promise<PersonaCopy[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .select()
    .from(personas)
    .where(and(eq(personas.workspaceId, workspaceId), inArray(personas.id, [...ids])));
  return ids.flatMap((id) => {
    const row = rows.find((persona) => persona.id === id);
    return row ? [copyOf(row)] : [];
  });
}

/** Checks a persona's fields, raising every problem at once (personas spec, "Personas are records in the workspace"). */
export function validatePersona(fields: PersonaFields): PersonaFields {
  const issues = new IssueCollector();
  const clean = {
    name: fields.name.trim(),
    role: fields.role.trim(),
    organizationType: fields.organizationType.trim(),
    goals: fields.goals.map((goal) => goal.trim()).filter(Boolean),
    context: fields.context.trim(),
    constraints: fields.constraints.map((constraint) => constraint.trim()).filter(Boolean),
    distinction: fields.distinction?.trim() || null,
  };
  if (!clean.name) issues.add("name", "Enter the persona's name.");
  else if (clean.name.length > PERSONA_FIELDS.name) issues.add("name", `Use at most ${PERSONA_FIELDS.name} characters.`);
  if (!clean.role) issues.add("role", "Enter the persona's role.");
  else if (clean.role.length > PERSONA_FIELDS.role) issues.add("role", `Use at most ${PERSONA_FIELDS.role} characters.`);
  if (clean.organizationType.length > PERSONA_FIELDS.organizationType) issues.add("organizationType", `Use at most ${PERSONA_FIELDS.organizationType} characters.`);
  if (clean.goals.length === 0) issues.add("goals", "Add at least one goal.");
  else if (clean.goals.length > MAX_GOALS) issues.add("goals", `List at most ${MAX_GOALS} goals.`);
  else if (clean.goals.some((goal) => goal.length > PERSONA_FIELDS.goal)) issues.add("goals", `Keep each goal to ${PERSONA_FIELDS.goal} characters.`);
  if (clean.context.length > PERSONA_FIELDS.context) issues.add("context", `Use at most ${PERSONA_FIELDS.context} characters.`);
  if (clean.constraints.length > MAX_CONSTRAINTS) issues.add("constraints", `List at most ${MAX_CONSTRAINTS} constraints.`);
  else if (clean.constraints.some((constraint) => constraint.length > PERSONA_FIELDS.constraint)) issues.add("constraints", `Keep each constraint to ${PERSONA_FIELDS.constraint} characters.`);
  if ((clean.distinction?.length ?? 0) > PERSONA_FIELDS.distinction) issues.add("distinction", `Use at most ${PERSONA_FIELDS.distinction} characters.`);
  issues.throwIfAny();
  return clean;
}

export async function createPersona(db: PrototypesExecutor, workspaceId: string, fields: PersonaFields, now = new Date()): Promise<Persona> {
  const clean = validatePersona(fields);
  return db.transaction(async (tx) => {
    await claimSlot(tx, workspaceId, "personaCount", PERSONA_LIMIT, `A workspace can hold ${PERSONA_LIMIT} personas. Delete one to add another.`);
    const [persona] = await tx
      .insert(personas)
      .values({ ...clean, goals: [...clean.goals], constraints: [...clean.constraints], id: generatePublicId("per"), workspaceId, createdAt: now, updatedAt: now })
      .returning();
    return persona!;
  });
}

export async function updatePersona(db: PrototypesExecutor, workspaceId: string, personaId: string, fields: PersonaFields, now = new Date()): Promise<Persona> {
  const clean = validatePersona(fields);
  const [persona] = await db
    .update(personas)
    .set({ ...clean, goals: [...clean.goals], constraints: [...clean.constraints], updatedAt: now })
    .where(and(eq(personas.workspaceId, workspaceId), eq(personas.id, personaId)))
    .returning();
  if (!persona) throw new NotFoundError("Unknown persona");
  return persona;
}

/** Removes a persona from future choices; versions generated for it keep their copy (personas spec, "Deleting a persona in use"). */
export async function deletePersona(db: PrototypesExecutor, workspaceId: string, personaId: string): Promise<Persona> {
  return db.transaction(async (tx) => {
    const [persona] = await tx
      .delete(personas)
      .where(and(eq(personas.workspaceId, workspaceId), eq(personas.id, personaId)))
      .returning();
    if (!persona) throw new NotFoundError("Unknown persona");
    await releaseSlot(tx, workspaceId, "personaCount");
    return persona;
  });
}
