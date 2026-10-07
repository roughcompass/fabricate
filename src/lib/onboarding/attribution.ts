import type { Executor } from "@/lib/db/client";
import { ValidationError } from "@/lib/db/errors";
import { type Attribution, type LifecycleState, type OnboardingEvent, type OnboardingSubject, onboardingEvents } from "@/lib/db/schema";

/*
 * Who acted (design decision 9). Fabricate has no sign-in, so a person types
 * their name, or reuses the one the browser remembers. Every action keeps
 * that name labeled Unverified: it says who someone claimed to be, grants no
 * authority, and authorizes nothing in Studio or CDaaS. It's never copied
 * into a Portal, Application, or MFE, which name their owning team instead,
 * and nothing derives an email from it.
 * DE FabLab's own changes, such as a readiness check after a
 * reconciliation, are attributed to DE FabLab.
 */

export interface Actor {
  name: string;
  attribution: Attribution;
}

export const SYSTEM_ACTOR: Actor = Object.freeze({ name: "DE FabLab", attribution: "system" });

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
  revision?: number | null;
  from?: LifecycleState | null;
  to?: LifecycleState | null;
  reason?: string | null;
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
      microfrontendId: subject === "microfrontend" ? identityId : null,
      revision: input.revision ?? null,
      event: input.event,
      fromLifecycle: input.from ?? null,
      toLifecycle: input.to ?? null,
      reason: input.reason?.trim() || null,
      actor: input.actor.name,
      attribution: input.actor.attribution,
      occurredAt: input.at ?? new Date(),
    })
    .run();
}
