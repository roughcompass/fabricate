import { CloneUrl, InvalidCloneUrl } from "@/lib/catalog/clone-url";

/*
 * Which repository a URL names, and on which provider (application-creation
 * spec, "Repository URLs must be Bitbucket or GitHub"; design decision 5).
 * It builds on CloneUrl, which already refuses credentials, unsafe
 * transports, and dot segments, then classifies the host: github.com is
 * GitHub, and a configured host is Bitbucket, Server or bitbucket.org. A
 * local file:// repository is accepted only where a caller allows it, and
 * the catalog's source boundary still decides whether it's inside an allowed
 * root. The prompt bar and the create form both use it, so the module
 * imports nothing that can't ship to the browser.
 */

export const GIT_PROVIDERS = ["github", "bitbucket", "local"] as const;
export type GitProvider = (typeof GIT_PROVIDERS)[number];
export const GIT_PROVIDER_LABELS: Record<GitProvider, string> = { github: "GitHub", bitbucket: "Bitbucket", local: "Local repository" };

export type RepositoryUrlProblem = "blank" | "credentials" | "unsupported_host" | "not_a_repository" | "malformed";

export const REPOSITORY_URL_MESSAGES: Record<RepositoryUrlProblem, string> = {
  blank: "Enter the repository's URL",
  credentials: "The URL must not include credentials. Remove the user name, password, or token, and configure credentials for the host instead",
  unsupported_host: "Only Bitbucket and GitHub repository URLs are accepted",
  not_a_repository: "Enter the URL of a repository, such as https://github.com/acme/payee-hub",
  malformed: "Enter a repository URL that starts with https:// or ssh://",
};

export class RepositoryUrlError extends Error {
  override name = "RepositoryUrlError";

  constructor(readonly problem: RepositoryUrlProblem) {
    super(REPOSITORY_URL_MESSAGES[problem]);
  }
}

export interface RepositoryUrl {
  provider: GitProvider;
  /** The GitHub owner, Bitbucket project key or workspace, or null for a local repository. */
  owner: string | null;
  /** The repository's name, without ".git". */
  name: string;
  /** What Git clones: the URL as entered, normalized. */
  cloneUrl: string;
  /** Where a person opens the repository, or null for a local repository. */
  webUrl: string | null;
}

export interface RepositoryUrlOptions {
  /** Hosts, lowercase, whose URLs are Bitbucket repositories (config.applications.bitbucketHosts). */
  bitbucketHosts: readonly string[];
  /** Accept a file:// repository, for the create form; the prompt bar doesn't. */
  allowLocal?: boolean;
}

const SEGMENT = /^[A-Za-z0-9._-]+$/;
const SCP = /^([A-Za-z0-9_][A-Za-z0-9._-]*)@([A-Za-z0-9.-]+):(?!\/\/)(.+)$/;

/** git@host:owner/repo.git, the scp-style form Git accepts, as the ssh:// URL CloneUrl parses. */
export function normalizeScp(input: string): string {
  const match = SCP.exec(input.trim());
  return match ? `ssh://${match[1]}@${match[2]}/${match[3]!.replace(/^\/+/, "")}` : input.trim();
}

const withoutGit = (name: string) => name.replace(/\.git$/, "");
const hostOf = (url: CloneUrl) => `${url.host}${url.port ? `:${url.port}` : ""}`;

/** The repository +input+ names, or a RepositoryUrlError saying why it isn't one. The error never repeats the input. */
export function parseRepositoryUrl(input: string, options: RepositoryUrlOptions): RepositoryUrl {
  if (!input.trim()) throw new RepositoryUrlError("blank");
  let url: CloneUrl;
  try {
    url = CloneUrl.parse(normalizeScp(input));
  } catch (error) {
    if (error instanceof InvalidCloneUrl) throw new RepositoryUrlError(error.code === "embedded_credentials" ? "credentials" : error.code === "blank" ? "blank" : "malformed");
    throw error;
  }
  if (url.isFile) {
    if (!options.allowLocal) throw new RepositoryUrlError("unsupported_host");
    return { provider: "local", owner: null, name: withoutGit(url.path.split("/").at(-1)!), cloneUrl: url.toString(), webUrl: null };
  }

  const segments = url.path.split("/").filter(Boolean);
  const valid = (...values: (string | undefined)[]) => values.every((value) => value !== undefined && SEGMENT.test(value));
  const host = hostOf(url);
  const clone = (path: string) => (url.scheme === "https" ? `https://${host}${path}` : url.toString());

  if (url.host === "github.com") {
    const [owner, repository] = segments;
    if (segments.length !== 2 || !valid(owner, repository)) throw new RepositoryUrlError("not_a_repository");
    const name = withoutGit(repository!);
    return { provider: "github", owner: owner!, name, cloneUrl: clone(`/${owner}/${name}.git`), webUrl: `https://github.com/${owner}/${name}` };
  }

  if (!options.bitbucketHosts.includes(host) && !options.bitbucketHosts.includes(url.host ?? "")) throw new RepositoryUrlError("unsupported_host");

  if (url.host === "bitbucket.org") {
    const [workspace, repository] = segments;
    if (segments.length !== 2 || !valid(workspace, repository)) throw new RepositoryUrlError("not_a_repository");
    const name = withoutGit(repository!);
    return { provider: "bitbucket", owner: workspace!, name, cloneUrl: clone(`/${workspace}/${name}.git`), webUrl: `https://bitbucket.org/${workspace}/${name}` };
  }

  // Bitbucket Server: the browse address /projects/KEY/repos/name, the clone address /scm/key/name.git, or an SSH /key/name.git.
  let key: string | undefined;
  let repository: string | undefined;
  if (segments[0] === "projects" && segments[2] === "repos" && (segments.length === 4 || (segments.length === 5 && segments[4] === "browse"))) [key, repository] = [segments[1], segments[3]];
  else if (segments[0] === "scm" && segments.length === 3) [key, repository] = [segments[1], segments[2]];
  else if (url.scheme === "ssh" && segments.length === 2) [key, repository] = [segments[0], segments[1]];
  if (!valid(key, repository)) throw new RepositoryUrlError("not_a_repository");
  const name = withoutGit(repository!);
  return {
    provider: "bitbucket",
    owner: key!.toUpperCase(),
    name,
    cloneUrl: clone(`/scm/${key!.toLowerCase()}/${name}.git`),
    webUrl: `https://${url.host}/projects/${key!.toUpperCase()}/repos/${name}`,
  };
}

/** The provider +input+ names, or null while it isn't a repository URL yet: what the create form shows as the URL is typed. */
export function detectProvider(input: string, options: RepositoryUrlOptions): GitProvider | null {
  try {
    return parseRepositoryUrl(input, options).provider;
  } catch {
    return null;
  }
}
