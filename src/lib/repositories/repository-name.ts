/**
 * A Repository's default name from its clone URL: the owner and the
 * repository, joined by a hyphen, without a trailing slash or `.git`.
 * https://github.com/vickykatoch/helios.git is vickykatoch-helios, and so
 * are its ssh:// and scp-style forms. A local file:// path has no owner, so
 * it's named after its directory alone, as is a URL with a single path
 * segment. Empty when the URL names no repository. No Node or database
 * dependencies, so the form derives the same name as the server while the
 * URL is typed.
 */
export function repositoryNameFromUrl(cloneUrl: string): string {
  const trimmed = cloneUrl.trim().replace(/[?#].*$/, "");
  const local = /^file:/i.test(trimmed);
  const path = trimmed
    // scp-style shorthand: user@host:owner/repo.git
    .replace(/^[^/@:]+@[^/:]+:/, "/")
    .replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, "");
  const segments = path
    .split(/[/\\]/)
    .filter(Boolean)
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    });
  const repository = (segments.at(-1) ?? "").replace(/\.git$/i, "").trim();
  if (!repository) return "";
  const owner = local ? "" : (segments.at(-2) ?? "").trim();
  return (owner ? `${owner}-${repository}` : repository).slice(0, 100);
}
