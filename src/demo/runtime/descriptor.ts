import type { EnvironmentId, Persona, Profile } from "@/lib/demo/catalog";
import type { HintState } from "@/lib/demo/workspaces";
import type { PortalExperience } from "./portal/types";

/**
 * A view's state as the demo's share links captured it: its route,
 * microfrontend overrides, theme, and session profile. Share links now
 * belong to applications (add-applications), so a reference deployment
 * never receives one; the runtime keeps the type until it's removed.
 */
export interface ShareState {
  readonly route: string;
  readonly overrides: Readonly<Record<string, { readonly version: string; readonly environment: EnvironmentId }>>;
  readonly theme: "light" | "dark";
  readonly persona: string;
  readonly profile?: { readonly name: string; readonly persona: Persona; readonly region: string };
}

/**
 * Everything the browser needs to run one view of an application, resolved on
 * the server by the runtime layout (design.md, decision 6). The template's
 * group and routes come from the catalog by slug, so only identifiers travel.
 */
export interface RuntimeDescriptor {
  /** ref-<slug>: the template's reference deployment. */
  readonly applicationId: string;
  readonly applicationName: string;
  readonly templateSlug: string;
  /** Reference deployments run in production. */
  readonly environment: EnvironmentId;
  readonly access: "reference" | "share";
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
  /** Its template's page in the Frontend Registry. */
  readonly pageHref: string;
  /** The brand's shell. */
  readonly shell: "access" | "markets";
  readonly experience: PortalExperience;
}
