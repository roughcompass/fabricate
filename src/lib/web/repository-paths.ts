/** Addresses of a Repository's pages (docs/profiling.md). */

/** The Repository's page, which shows its current profile version. */
export function repositoryHref(sourcePublicId: string): string {
  return `/repositories/${sourcePublicId}`;
}

/** The Repository's settings: its clone URL, name, and reference, and deleting it. */
export function settingsHref(sourcePublicId: string): string {
  return `/repositories/${sourcePublicId}/settings`;
}

/** Every profile version of the Repository, newest first. */
export function versionsHref(sourcePublicId: string, page = 1): string {
  return `/repositories/${sourcePublicId}/versions${page > 1 ? `?page=${page}` : ""}`;
}

/** One profile version of the Repository. */
export function versionHref(sourcePublicId: string, version: number): string {
  return `/repositories/${sourcePublicId}/versions/${version}`;
}
