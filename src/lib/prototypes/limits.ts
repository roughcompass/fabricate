/**
 * Prototypes' bounds (prototypes/availability spec, "Generation is bounded
 * per workspace" and "Workspace data is bounded"). The daily variant limit is
 * a setting; these are fixed.
 */

export const PROTOTYPE_LIMIT = 50;
export const PERSONA_LIMIT = 30;
export const LESSON_LIMIT = 100;
export const NOTE_LENGTH = 2_000;
export const LESSON_LENGTH = 280;
export const INTENT_LENGTH = { min: 10, max: 2_000 } as const;
/** The variant counts the composer offers (generation spec, "The composer takes an intent, scope, personas, and variant count"). */
/** With a template attached it is variant 0, so a generation has at least one new direction beside it. */
export const TEMPLATE_VARIANT_CHOICES = [2, 3, 4, 6, 8] as const;

export const VARIANT_CHOICES = [1, 2, 3, 4, 6, 8] as const;
export const DEFAULT_VARIANTS = 3;
export const MAX_PERSONAS_PER_INTENT = 3;
export const IDLE_DAYS = 30;

/** Raised when a bound would be exceeded; the message is shown to the visitor and names the limit. */
export class PrototypesLimitError extends Error {
  override name = "PrototypesLimitError";
}
