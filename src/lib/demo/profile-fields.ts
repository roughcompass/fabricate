import { z } from "zod";
import { BUILT_IN_PROFILES, PERSONAS } from "./catalog";

/**
 * The rules for a session profile's fields (template-demo/toolbar spec),
 * shared by the server and the Session tool, which checks them before it
 * sends anything. The server's check is the one that counts.
 */

export const PROFILE_FIELD_LIMIT = 60;

// C0 and C1 control characters, including line breaks and tabs.
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

const field = (label: string) =>
  z
    .string({ error: `Enter a ${label}` })
    .transform((value) => value.trim())
    .pipe(
      z
        .string()
        .min(1, `Enter a ${label}`)
        .max(PROFILE_FIELD_LIMIT, `Use at most ${PROFILE_FIELD_LIMIT} characters`)
        .refine((value) => !CONTROL.test(value), "Use letters, numbers, spaces, and punctuation only"),
    );

/** A profile's fields as a visitor submits them, and as a share link's snapshot stores them. */
export const profileFieldsSchema = z.strictObject({
  name: field("name"),
  persona: z.enum(PERSONAS, { error: "Choose a persona" }),
  region: field("region"),
});

export type ProfileFields = z.output<typeof profileFieldsSchema>;

/** The messages for invalid fields, by field; `base` for a problem with no field. Null when the fields are valid. */
export function profileFieldErrors(value: unknown): Record<string, string[]> | null {
  const parsed = profileFieldsSchema.safeParse(value);
  if (parsed.success) return null;
  const errors: Record<string, string[]> = {};
  for (const issue of parsed.error.issues) (errors[typeof issue.path[0] === "string" ? issue.path[0] : "base"] ??= []).push(issue.message);
  return errors;
}

/** The message for a name another profile has, ignoring case, including the built-in profiles' names. */
export const DUPLICATE_NAME = "A profile with that name already exists";

export const nameKey = (name: string) => name.toLowerCase();

export function nameTaken(name: string, others: readonly { readonly name: string }[]): boolean {
  const key = nameKey(name.trim());
  return [...BUILT_IN_PROFILES, ...others].some((profile) => nameKey(profile.name) === key);
}
