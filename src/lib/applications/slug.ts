/*
 * Application slugs (application-creation spec, "The slug is derived from
 * the name and can be edited"): lowercase letters, digits, and single
 * hyphens, starting with a letter, 63 characters or fewer. The create form
 * derives one as the name is typed and createApplication checks it again,
 * so both use this module. It imports nothing, because it ships to the
 * browser.
 */

export const APPLICATION_SLUG_MAX = 63;
export const APPLICATION_SLUG = /^[a-z](?:[a-z0-9]|-(?=[a-z0-9])){0,62}$/;

/**
 * The slug a name derives: accents folded, lowercased, each run of anything
 * but letters and digits one hyphen, and hyphens trimmed from both ends, cut
 * to 63 characters. "Payee Hub 2" is `payee-hub-2`. A name that starts with
 * a digit derives a slug that APPLICATION_SLUG refuses.
 */
export function deriveApplicationSlug(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, APPLICATION_SLUG_MAX)
    .replace(/-+$/, "");
}

/** Why +slug+ isn't a valid slug, or null when it is. */
export function slugProblem(slug: string): string | null {
  if (!slug) return "Enter a slug";
  if (slug.length > APPLICATION_SLUG_MAX) return `Use ${APPLICATION_SLUG_MAX} characters or fewer`;
  if (!/^[a-z]/.test(slug)) return "Start the slug with a letter";
  if (!APPLICATION_SLUG.test(slug)) return "Use only lowercase letters, digits, and single hyphens";
  return null;
}
