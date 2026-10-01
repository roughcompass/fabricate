import { and, asc, count, eq, ne } from "drizzle-orm";
import { type Executor, immediate } from "@/lib/db/client";
import { ValidationError } from "@/lib/db/errors";
import { generatePublicId, isPublicId } from "@/lib/db/ids";
import { demoProfiles } from "@/lib/db/schema";
import { BUILT_IN_PROFILES, type Profile } from "./catalog";
import { DUPLICATE_NAME, type ProfileFields, nameKey, profileFieldErrors, profileFieldsSchema } from "./profile-fields";
import { DemoLimitError } from "./workspaces";

/**
 * Visitors' own session profiles (template-demo/toolbar spec; design.md,
 * decision 6). A profile names who is using a running application, with a
 * persona and a region. Every operation is scoped to one workspace, and the
 * built-in profiles are constants that can't be changed.
 */

export const PROFILE_LIMIT = 20;
export { PROFILE_FIELD_LIMIT, type ProfileFields, profileFieldsSchema } from "./profile-fields";

/** Validates submitted profile fields, raising every problem by field. */
export function parseProfileFields(value: unknown): ProfileFields {
  const errors = profileFieldErrors(value);
  if (errors) throw new ValidationError(Object.entries(errors).flatMap(([field, messages]) => messages.map((message) => ({ field, message }))));
  return profileFieldsSchema.parse(value);
}

export function isBuiltInProfileId(id: string): boolean {
  return BUILT_IN_PROFILES.some((profile) => profile.id === id);
}

const BUILT_IN_NAMES = new Set(BUILT_IN_PROFILES.map((profile) => nameKey(profile.name)));

function toProfile(row: typeof demoProfiles.$inferSelect): Profile {
  return { id: row.publicId, name: row.name, persona: row.persona, region: row.region, builtIn: false };
}

/** The workspace's own profiles, oldest first. */
export function listProfiles(db: Executor, workspaceId: number): Profile[] {
  return db.select().from(demoProfiles).where(eq(demoProfiles.workspaceId, workspaceId)).orderBy(asc(demoProfiles.createdAt), asc(demoProfiles.id)).all().map(toProfile);
}

function assertUniqueName(tx: Executor, workspaceId: number, key: string, except?: number): void {
  const taken = BUILT_IN_NAMES.has(key) || tx.select({ id: demoProfiles.id }).from(demoProfiles).where(and(eq(demoProfiles.workspaceId, workspaceId), eq(demoProfiles.nameKey, key), except === undefined ? undefined : ne(demoProfiles.id, except))).get();
  if (taken) throw new ValidationError([{ field: "name", message: DUPLICATE_NAME }]);
}

/** Creates a profile, refusing a 21st, a duplicate name, or invalid fields. */
export function createProfile(db: Executor, workspaceId: number, value: unknown, now = new Date()): Profile {
  const fields = parseProfileFields(value);
  return immediate(db, (tx) => {
    const existing = tx.select({ n: count() }).from(demoProfiles).where(eq(demoProfiles.workspaceId, workspaceId)).get()?.n ?? 0;
    if (existing >= PROFILE_LIMIT) throw new DemoLimitError(`You have ${PROFILE_LIMIT} custom profiles, the most a demo workspace can hold. Delete a profile to create another.`);
    assertUniqueName(tx, workspaceId, nameKey(fields.name));
    const row = tx
      .insert(demoProfiles)
      .values({ publicId: generatePublicId("dpf"), workspaceId, ...fields, nameKey: nameKey(fields.name), createdAt: now, updatedAt: now })
      .returning()
      .get();
    return toProfile(row);
  });
}

/** Changes one of the workspace's profiles; null when it has no such profile. */
export function updateProfile(db: Executor, workspaceId: number, profileId: string, value: unknown, now = new Date()): Profile | null {
  if (!isPublicId(profileId, "dpf")) return null;
  const fields = parseProfileFields(value);
  return immediate(db, (tx) => {
    const current = tx.select().from(demoProfiles).where(and(eq(demoProfiles.workspaceId, workspaceId), eq(demoProfiles.publicId, profileId))).get();
    if (!current) return null;
    assertUniqueName(tx, workspaceId, nameKey(fields.name), current.id);
    const row = tx
      .update(demoProfiles)
      .set({ ...fields, nameKey: nameKey(fields.name), updatedAt: now })
      .where(eq(demoProfiles.id, current.id))
      .returning()
      .get();
    return toProfile(row);
  });
}

/** Deletes one of the workspace's profiles; false when it has no such profile. */
export function deleteProfile(db: Executor, workspaceId: number, profileId: string): boolean {
  if (!isPublicId(profileId, "dpf")) return false;
  return db.delete(demoProfiles).where(and(eq(demoProfiles.workspaceId, workspaceId), eq(demoProfiles.publicId, profileId))).run().changes > 0;
}
