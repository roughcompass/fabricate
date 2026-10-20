"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db/client";
import { NotFoundError, StaleRecordError, TransitionError } from "@/lib/db/errors";
import { isPublicId } from "@/lib/db/ids";
import { catalogs } from "@/lib/experience/catalogs";
import type { Experience, ExperienceIssue } from "@/lib/experience/document";
import { ExperienceValidationError, saveExperience } from "@/lib/experience/versions";
import { UNSTATED_ACTOR, statedActor } from "@/lib/onboarding/attribution";
import { getPortal } from "@/lib/onboarding/portals";
import { rememberedActor } from "@/lib/web/actor-cookie";

export type SaveOutcome =
  | { kind: "saved"; number: number; lockVersion: number; experience: Experience }
  | { kind: "stale"; message: string }
  | { kind: "invalid"; issues: ExperienceIssue[] }
  | { kind: "nothing"; message: string };

/**
 * Saves the editor's working experience as the Portal's next version
 * (experience-editor spec, "Save commits every pending change as a saved
 * version"), attributed to the remembered name or "Not stated", Unverified.
 * A stale or invalid save writes nothing and says why; the editor keeps
 * every pending change.
 */
export async function saveExperienceAction(portalId: string, input: { baseNumber: number; lockVersion: number; document: unknown }): Promise<SaveOutcome> {
  if (!isPublicId(portalId, "ptl")) throw new NotFoundError("Unknown Portal");
  const db = getDb();
  const actor = statedActor((await rememberedActor()) || UNSTATED_ACTOR);
  try {
    const { version, experience } = saveExperience(db, portalId, { baseNumber: Number(input.baseNumber), lockVersion: Number(input.lockVersion), document: input.document }, actor, catalogs());
    // The Portal page, the switcher, and the running portal show the saved experience.
    revalidatePath("/", "layout");
    return { kind: "saved", number: version.number, lockVersion: getPortal(db, portalId).lockVersion, experience };
  } catch (error) {
    if (error instanceof StaleRecordError) return { kind: "stale", message: `${error.message}. Your changes are kept; reload the latest saved version to make them again on top of it.` };
    if (error instanceof ExperienceValidationError) return { kind: "invalid", issues: [...error.issues] };
    if (error instanceof TransitionError) return { kind: "nothing", message: error.message };
    throw error;
  }
}
