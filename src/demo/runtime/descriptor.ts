import type { EnvironmentId, Profile } from "@/lib/demo/catalog";
import type { ShareState } from "@/lib/demo/shares";
import type { HintState } from "@/lib/demo/workspaces";

/**
 * Everything the browser needs to run one view of an application, resolved on
 * the server by the runtime layout (design.md, decision 6). The template's
 * group and routes come from the catalog by slug, so only identifiers travel.
 */
export interface RuntimeDescriptor {
  /** A public application ID, or ref-<slug> for a reference deployment. */
  readonly applicationId: string;
  readonly applicationName: string;
  readonly templateSlug: string;
  /** The environment the application was deployed to; reference deployments run in production. */
  readonly environment: EnvironmentId;
  readonly access: "owner" | "reference" | "share";
  /** Scopes browser-held state to this view and to the workspace's reset epoch. */
  readonly viewKey: string;
  /** The state a share link captured, applied once as the recipient's starting state. */
  readonly shareState: ShareState | null;
  readonly shareToken: string | null;
  readonly displayName: string | null;
  readonly hints: HintState;
  /** The visitor's own session profiles, so the first render can show a custom active profile. */
  readonly profiles: readonly Profile[];
  /** The simulated address shown for the application. */
  readonly url: string;
  /** Whether the application's simulated build has finished; reference deployments are always ready. */
  readonly status: "ready" | "building";
  /** The application's page in Fabricate, or its template's page for a reference deployment or a shared view. */
  readonly pageHref: string;
}
