import type { Db } from "@/lib/db/client";
import { type Actor, statedActor } from "@/lib/onboarding/attribution";
import { type Portal, type PortalInput, createPortal } from "@/lib/onboarding/portals";

/*
 * Builders for onboarding tests: Portals created the way Create Portal
 * creates them, with every required value filled in.
 */

export const ana: Actor = statedActor("ana@example.com");
export const cy: Actor = statedActor("cy@example.com");

/** Create Portal's values for a Web Portal named +name+, its slug derived. */
export function portalInput(name: string, overrides: Partial<PortalInput> = {}): PortalInput {
  return { name, sealId: "88001", platform: "web", ownerTeam: `${name} Platform`, description: `The ${name} Portal`, ...overrides };
}

/** A Portal created as a Prototype. */
export function onboardPortal(db: Db, name: string, overrides: Partial<PortalInput> = {}, actor = ana): Portal {
  return createPortal(db, portalInput(name, overrides), actor).portal;
}
