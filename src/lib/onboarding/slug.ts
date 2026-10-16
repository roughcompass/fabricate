/*
 * Portal slugs (portal-creation spec): 1 to 63 lowercase letters, a to z,
 * with no digits, spaces, or other characters. The create form derives one
 * from the name as it's typed, and createPortal checks it again, so both use
 * this module. It imports nothing, because it ships to the browser.
 */

export const SLUG_MAX = 63;
export const SLUG = /^[a-z]{1,63}$/;

/** Lowercases +value+ and removes every character that isn't a to z, folding accented letters to their base letters first. */
export function slugCharacters(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^a-z]+/g, "");
}

/** The slug a Portal name derives: "My New Portal" is `mynewportal`, and "2026" is the empty string. */
export function deriveSlug(name: string): string {
  return slugCharacters(name).slice(0, SLUG_MAX);
}
