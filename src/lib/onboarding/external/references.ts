import { and, asc, eq, isNull } from "drizzle-orm";
import type { Executor } from "@/lib/db/client";
import { ValidationError } from "@/lib/db/errors";
import { generatePublicId } from "@/lib/db/ids";
import { type ExternalResourceType, type ExternalSystem, type ReferenceSource, applicationPlacements, applications, externalReferences, microfrontends, portals } from "@/lib/db/schema";
import type { Actor } from "../attribution";

/*
 * External references (design decision 7). A Portal, Web Application, MFE,
 * or placement is linked to a Studio or CDaaS resource only by an explicit
 * reference that someone stated, that a submitted revision declared, or
 * that Fabricate discovered and recorded as such. Nothing is matched by
 * name, SEAL ID, or another system's identifier: a Studio channel is never
 * assumed to be a Portal because their names agree.
 */

export type ExternalReference = typeof externalReferences.$inferSelect;
export type ReferenceSubject = { kind: "portal" | "application" | "microfrontend" | "placement"; id: number };

/** The resource types each system has, and the record each one maps. */
export const REFERENCE_TYPES: Record<ExternalSystem, Partial<Record<ExternalResourceType, { subject: ReferenceSubject["kind"]; environment: "required" | "optional" | "none"; label: string }>>> = {
  studio: {
    channel: { subject: "portal", environment: "optional", label: "Studio channel" },
    environment: { subject: "portal", environment: "required", label: "Studio environment" },
    module_group: { subject: "application", environment: "optional", label: "Studio module group" },
    module: { subject: "microfrontend", environment: "optional", label: "Studio module" },
    menu: { subject: "placement", environment: "required", label: "Studio menu" },
  },
  cdaas: { application_view: { subject: "microfrontend", environment: "none", label: "CDaaS application view" } },
};

const subjectKey = (subject: ReferenceSubject) => `${subject.kind}:${subject.id}`;
const subjectColumns = (subject: ReferenceSubject) => ({
  portalId: subject.kind === "portal" ? subject.id : null,
  applicationId: subject.kind === "application" ? subject.id : null,
  microfrontendId: subject.kind === "microfrontend" ? subject.id : null,
  placementId: subject.kind === "placement" ? subject.id : null,
});

export interface ReferenceInput {
  system: ExternalSystem;
  resourceType: ExternalResourceType;
  externalId: string;
  environment?: string | null;
  subject: ReferenceSubject;
  source: ReferenceSource;
  actor: Actor;
}

const EXTERNAL_ID = /^[A-Za-z0-9._:/-]{1,128}$/;

/**
 * Records that +subject+ is +externalId+ in another system, replacing the
 * subject's earlier reference of that type. A resource another record
 * already maps is refused, not taken over.
 */
export function declareReference(db: Executor, input: ReferenceInput): ExternalReference {
  const type = REFERENCE_TYPES[input.system][input.resourceType];
  const environment = input.environment?.trim() || null;
  const externalId = input.externalId.trim();
  if (!type || type.subject !== input.subject.kind) throw new ValidationError([{ field: "resourceType", message: `A ${input.system} ${input.resourceType.replace("_", " ")} doesn't map to a ${input.subject.kind}` }]);
  if (!EXTERNAL_ID.test(externalId)) throw new ValidationError([{ field: "externalId", message: "An external ID is letters, digits, and . _ : / -" }]);
  if (type.environment === "required" && !environment) throw new ValidationError([{ field: "environment", message: `Name the environment of this ${type.label}` }]);
  if (type.environment === "none" && environment) throw new ValidationError([{ field: "environment", message: `A ${type.label} isn't environment-specific` }]);

  const sameEnvironment = environment === null ? isNull(externalReferences.environment) : eq(externalReferences.environment, environment);
  const active = and(eq(externalReferences.system, input.system), eq(externalReferences.resourceType, input.resourceType), sameEnvironment, isNull(externalReferences.retiredAt));
  const current = db.select().from(externalReferences).where(and(active, eq(externalReferences.subject, subjectKey(input.subject)))).get();
  if (current?.externalId === externalId) return current;
  const holder = db.select().from(externalReferences).where(and(active, eq(externalReferences.externalId, externalId))).get();
  if (holder) throw new ValidationError([{ field: "externalId", message: `${type.label} ${externalId} is already mapped to ${describeSubject(db, holder)}` }]);
  const now = new Date();
  if (current) db.update(externalReferences).set({ retiredAt: now }).where(eq(externalReferences.id, current.id)).run();
  return db
    .insert(externalReferences)
    .values({
      publicId: generatePublicId("xrf"),
      system: input.system,
      resourceType: input.resourceType,
      externalId,
      environment,
      ...subjectColumns(input.subject),
      subject: subjectKey(input.subject),
      source: input.source,
      providedBy: input.actor.name,
      attribution: input.actor.attribution,
      recordedAt: now,
    })
    .returning()
    .get();
}

/** Ends a subject's reference of one type, keeping it in the history. */
export function retireReference(db: Executor, reference: ExternalReference): void {
  if (reference.retiredAt === null) db.update(externalReferences).set({ retiredAt: new Date() }).where(eq(externalReferences.id, reference.id)).run();
}

/** Ends every current reference of a record that's being retired: a retired record maps nothing. */
export function retireReferencesOf(db: Executor, subject: ReferenceSubject): void {
  for (const reference of referencesOf(db, subject)) retireReference(db, reference);
}

/** A subject's current references, by system and type. */
export function referencesOf(db: Executor, subject: ReferenceSubject): ExternalReference[] {
  return db
    .select()
    .from(externalReferences)
    .where(and(eq(externalReferences.subject, subjectKey(subject)), isNull(externalReferences.retiredAt)))
    .orderBy(asc(externalReferences.system), asc(externalReferences.resourceType), asc(externalReferences.environment))
    .all();
}

/** A subject's current reference of one type and environment. */
export function referenceOf(db: Executor, subject: ReferenceSubject, system: ExternalSystem, resourceType: ExternalResourceType, environment: string | null = null): ExternalReference | undefined {
  return referencesOf(db, subject).find((reference) => reference.system === system && reference.resourceType === resourceType && reference.environment === environment);
}

/** Every current reference, for refreshing them all. */
export function activeReferences(db: Executor): ExternalReference[] {
  return db.select().from(externalReferences).where(isNull(externalReferences.retiredAt)).orderBy(asc(externalReferences.id)).all();
}

/** How a mapped record reads, for a conflict message. */
function describeSubject(db: Executor, reference: ExternalReference): string {
  if (reference.portalId) return `the Portal ${db.select({ label: portals.label }).from(portals).where(eq(portals.id, reference.portalId)).get()?.label ?? reference.subject}`;
  if (reference.applicationId) return `the Web Application ${db.select({ name: applications.name }).from(applications).where(eq(applications.id, reference.applicationId)).get()?.name ?? reference.subject}`;
  if (reference.microfrontendId) return `the MFE ${db.select({ name: microfrontends.name }).from(microfrontends).where(eq(microfrontends.id, reference.microfrontendId)).get()?.name ?? reference.subject}`;
  return `the placement ${db.select({ publicId: applicationPlacements.publicId }).from(applicationPlacements).where(eq(applicationPlacements.id, reference.placementId!)).get()?.publicId ?? reference.subject}`;
}
