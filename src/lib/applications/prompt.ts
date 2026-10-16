import { REPOSITORY_URL_MESSAGES, RepositoryUrlError, parseRepositoryUrl } from "./repository-url";

/*
 * The Add application prompt bar (application-creation spec, "The prompt bar
 * accepts a repository URL or a description"): a Bitbucket or GitHub
 * repository URL opens Create Application with it filled in and no starter;
 * any other URL is refused; and anything else opens the full catalog
 * searched for it.
 */

export type BuildRoute = { kind: "redirect"; href: string } | { kind: "error"; message: string; keep: boolean };

export const SEARCH_LIMIT = 100;

/** Something typed as an address: a scheme, scp-style SSH, or a host and a path, with no spaces. */
const URL_LIKE = /^([a-z][a-z0-9+.-]*:\/\/|[A-Za-z0-9_][A-Za-z0-9._-]*@[A-Za-z0-9.-]+:|[a-z0-9-]+(\.[a-z0-9-]+)+\/)/i;

export function routeBuildPrompt(input: string, bitbucketHosts: readonly string[]): BuildRoute {
  const text = input.trim().replace(/\s+/g, " ");
  if (!text) return { kind: "error", message: "Paste a Bitbucket or GitHub repository URL, or describe what you want to build", keep: true };
  if (!URL_LIKE.test(text) || text.includes(" ")) return { kind: "redirect", href: `/applications/new/templates?${new URLSearchParams({ q: text.slice(0, SEARCH_LIMIT) })}` };

  // A host and path typed without a scheme is read as https.
  const address = /^[a-z0-9-]+(\.[a-z0-9-]+)+\//i.test(text) ? `https://${text}` : text;
  try {
    const repository = parseRepositoryUrl(address, { bitbucketHosts });
    return { kind: "redirect", href: `/applications/new/create?${new URLSearchParams({ repo: repository.cloneUrl.startsWith("ssh://") ? address : (repository.webUrl ?? address), from: "new" })}` };
  } catch (error) {
    if (!(error instanceof RepositoryUrlError)) throw error;
    // A URL with credentials isn't kept in the field, so the token isn't shown again.
    if (error.problem === "credentials") return { kind: "error", message: REPOSITORY_URL_MESSAGES.credentials, keep: false };
    return { kind: "error", message: error.problem === "unsupported_host" ? "Only Bitbucket and GitHub repository URLs are accepted" : error.message, keep: true };
  }
}
