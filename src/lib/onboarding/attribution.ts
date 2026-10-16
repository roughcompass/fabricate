import type { Executor } from "@/lib/db/client";
import { ValidationError } from "@/lib/db/errors";
import { type Attribution, type OnboardingEvent, type OnboardingSubject, type PortalLifecycle, onboardingEvents } from "@/lib/db/schema";

/*
 * Who acted (reviews spec). Fabricate has no sign-in, and no form asks for a
 * name: each change is recorded as the name the browser remembers, or "Not
 * stated", labeled Unverified. It says who someone claimed to be, grants no
 * authority, and authorizes nothing in Studio, CDaaS, Bitbucket, or GitHub.
 * It's never copied into a Portal or Application, which name their owning
 * team instead, and nothing derives an email from it. DE FabLab's own
 * changes are attributed to DE FabLab.
 */

export interface Actor {
  name: string;
  attribution: Attribution;
}

export const SYSTEM_ACTOR: Actor = Object.freeze({ name: "DE FabLab", attribution: "system" });

/** Who an action is recorded as when the browser remembers no name. */
export const UNSTATED_ACTOR = "Not stated";

/** The name a person states, trimmed, or a ValidationError on +field+. */
export function statedActor(name: string | null | undefined, field = "actor"): Actor {
  const value = (name ?? "").trim().replace(/\s+/g, " ");
  if (!value) throw new ValidationError([{ field, message: "Enter your name" }]);
  if (value.length > 200) throw new ValidationError([{ field, message: "Your name must be 200 characters or fewer" }]);
  return { name: value, attribution: "unverified" };
}

/** How an attribution reads everywhere it's shown. */
export function attributionLabel(attribution: Attribution): string {
  return attribution === "system" ? "Automatic" : "Unverified";
}

export interface EventInput {
  event: OnboardingEvent;
  from?: PortalLifecycle | null;
  to?: PortalLifecycle | null;
  /** What changed, as people read it: "Added Payees at /payees". */
  detail?: string | null;
  actor: Actor;
  at?: Date;
}

/** Appends one event to an onboarding record's history. */
export function recordEvent(db: Executor, subject: OnboardingSubject, identityId: number, input: EventInput): void {
  db.insert(onboardingEvents)
    .values({
      subject,
      portalId: subject === "portal" ? identityId : null,
      applicationId: subject === "application" ? identityId : null,
      event: input.event,
      fromLifecycle: input.from ?? null,
      toLifecycle: input.to ?? null,
      detail: input.detail?.trim().slice(0, 500) || null,
      actor: input.actor.name,
      attribution: input.actor.attribution,
      occurredAt: input.at ?? new Date(),
    })
    .run();
}
