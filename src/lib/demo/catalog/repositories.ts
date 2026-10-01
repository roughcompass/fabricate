/**
 * The demo's BitBucket (design.md, decision 18): fictional projects and
 * repositories a visitor can import. Each repository is built from a catalog
 * template, so an import renders like a deployed template. Nothing here is
 * fetched from, or sent to, a real BitBucket.
 */

export interface BitbucketProject {
  readonly key: string;
  readonly name: string;
}

export interface BitbucketRepository {
  readonly project: string;
  readonly name: string;
  readonly description: string;
  /** The catalog template the repository was created from. */
  readonly templateSlug: string;
  readonly defaultBranch: string;
  /** When the repository last changed, as an ISO date. */
  readonly updated: string;
}

export const BITBUCKET_PROJECTS: readonly BitbucketProject[] = [
  { key: "PAY", name: "Payments" },
  { key: "GB", name: "Global Banking" },
  { key: "MKT", name: "Markets" },
  { key: "OPS", name: "Operations" },
];

export const BITBUCKET_REPOSITORIES: readonly BitbucketRepository[] = [
  { project: "PAY", name: "payee-hub", description: "Payees, transfers, and payment activity for treasury teams.", templateSlug: "payments-workspace", defaultBranch: "main", updated: "2026-09-24" },
  { project: "PAY", name: "card-controls", description: "Spending limits and merchant controls for corporate cards.", templateSlug: "corporate-card-controls", defaultBranch: "main", updated: "2026-09-18" },
  { project: "PAY", name: "payment-tracker", description: "End-to-end status of outgoing payments.", templateSlug: "payment-status-tracker", defaultBranch: "main", updated: "2026-09-02" },
  { project: "GB", name: "onboarding-portal", description: "Client onboarding with KYC checks and document review.", templateSlug: "client-onboarding", defaultBranch: "main", updated: "2026-09-21" },
  { project: "GB", name: "facility-tracker", description: "Credit facilities, utilization, and covenants.", templateSlug: "credit-facility-tracker", defaultBranch: "main", updated: "2026-08-30" },
  { project: "GB", name: "deal-room", description: "A shared workspace for deal teams.", templateSlug: "deal-room", defaultBranch: "develop", updated: "2026-09-10" },
  { project: "MKT", name: "market-watch", description: "Watchlists, price charts, and order entry.", templateSlug: "market-watch", defaultBranch: "main", updated: "2026-09-25" },
  { project: "MKT", name: "fx-board", description: "Live FX rates for the trading floor.", templateSlug: "fx-rates-board", defaultBranch: "main", updated: "2026-09-15" },
  { project: "MKT", name: "risk-limits", description: "Limit utilization and breaches by desk.", templateSlug: "risk-limits-monitor", defaultBranch: "main", updated: "2026-09-08" },
  { project: "OPS", name: "ops-console", description: "Incidents, service health, and the change calendar.", templateSlug: "operations-console", defaultBranch: "main", updated: "2026-09-23" },
  { project: "OPS", name: "release-calendar", description: "Planned releases and freeze windows.", templateSlug: "release-calendar", defaultBranch: "main", updated: "2026-09-05" },
  { project: "OPS", name: "flag-console", description: "Feature flags across environments.", templateSlug: "feature-flag-console", defaultBranch: "main", updated: "2026-08-27" },
];

/** The project the import page shows until the visitor chooses another. */
export const DEFAULT_PROJECT = BITBUCKET_PROJECTS[0]!.key;

export function projectByKey(key: string): BitbucketProject | undefined {
  return BITBUCKET_PROJECTS.find((project) => project.key === key);
}

export function repositoriesIn(project: string): BitbucketRepository[] {
  return BITBUCKET_REPOSITORIES.filter((repository) => repository.project === project);
}

export function findRepository(project: string, name: string): BitbucketRepository | undefined {
  return BITBUCKET_REPOSITORIES.find((repository) => repository.project === project && repository.name === name);
}

/** An application name from a repository name: "payee-hub" becomes "Payee hub". */
export function applicationNameFor(repository: Pick<BitbucketRepository, "name">): string {
  const words = repository.name.split("-").filter(Boolean);
  return words.map((word, index) => (index === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word)).join(" ");
}
