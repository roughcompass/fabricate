/**
 * Types for the template demo's catalog: templates, the microfrontends group
 * each template deploys as, and the scripts that make loading and building
 * deterministic. Everything here is static data shipped with the code, so it
 * is identical in every workspace and on every run (design.md, decision 2).
 */

export const BRAND_IDS = ["payments", "global-banking", "markets", "other"] as const;
export type BrandId = (typeof BRAND_IDS)[number];

export const PROVIDER_IDS = ["de-web", "community"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

/** How a template was made, apart from who provides it (template-gallery spec, "The filter rail filters by brand and provider"). */
export const ORIGIN_IDS = ["built-in", "prototypes"] as const;
export type OriginId = (typeof ORIGIN_IDS)[number];

export const ENVIRONMENTS = ["production", "sandbox", "dev"] as const;
export type EnvironmentId = (typeof ENVIRONMENTS)[number];

/** The portal shells: J.P. Morgan Access (left navigation) and J.P. Morgan Markets (two-row top navigation). */
export type ShellKind = "access" | "markets";

export interface Brand {
  readonly id: BrandId;
  readonly label: string;
  /** The portal shell applications of this brand render in. */
  readonly shell: ShellKind;
  /** The portal's name, shown as a text wordmark: the shells are illustrative and use no logo images. */
  readonly portalName: string;
  readonly tagline: string;
}

export interface Provider {
  readonly id: ProviderId;
  readonly label: string;
}

export interface MemberVersion {
  readonly version: string;
  readonly prerelease?: boolean;
  /** What a viewer sees change in this version. */
  readonly summary: string;
}

/** Where a member renders: as a route's owner, or in a slot on another route. */
export type MemberRouting = { readonly kind: "shell" } | { readonly kind: "route"; readonly path: string } | { readonly kind: "slot"; readonly route: string; readonly slot: string };

export interface GroupMember {
  readonly id: string;
  readonly name: string;
  readonly role: "default" | "child";
  readonly owner: string;
  readonly routing: MemberRouting;
  readonly versions: readonly MemberVersion[];
  readonly defaultVersion: string;
  /** Scripted load duration in milliseconds. */
  readonly loadMs: number;
  /** Scripted duration when a version change reloads this member. */
  readonly swapMs: number;
  readonly publishes?: readonly string[];
  readonly subscribes?: readonly string[];
  /** Renders differently for the Approver role. */
  readonly roleDependent?: boolean;
}

export type RegionArea = "main" | "side" | "wide";

export interface AppRoute {
  /** Path within the application, without a leading slash. */
  readonly path: string;
  readonly label: string;
  /** The member that owns this route (its zone). */
  readonly owner: string;
  /** Members rendered on this route, in load order. */
  readonly regions: readonly { readonly member: string; readonly area: RegionArea }[];
}

/** A template's microfrontends group and its routes; every member version is committed Salt source under src/demo/runtime/generated/. */
export interface AppDefinition {
  readonly members: readonly GroupMember[];
  readonly routes: readonly AppRoute[];
}

export interface Template {
  readonly slug: string;
  readonly title: string;
  readonly description: string;
  readonly brand: BrandId;
  readonly provider: ProviderId;
  /** Every catalog template is built in; templates accepted from prototypes are From Prototypes. */
  readonly origin: "built-in";
  /** Shown for community templates. */
  readonly author?: string;
  readonly tags: readonly string[];
  /** One of the four full hero templates, one per brand, built to tell the whole toolbar story; listed first in the gallery. */
  readonly hero: boolean;
  readonly version: string;
  readonly preview: { readonly src: string; readonly alt: string };
  readonly app: AppDefinition;
}

/** The access types a session profile can have. */
export const PERSONAS = ["Analyst", "Approver", "Administrator"] as const;
export type Persona = (typeof PERSONAS)[number];

/**
 * Who is using a running application: a person, with a persona (their access
 * type) and a region. Built-in profiles are constants; a visitor's own are
 * stored in their workspace, and a share link can carry a snapshot of one.
 */
export interface Profile {
  /** A built-in id (`analyst`, `approver`, `administrator`), a public id, or `shared` for a share link's snapshot. */
  readonly id: string;
  readonly name: string;
  readonly persona: Persona;
  readonly region: string;
  readonly builtIn: boolean;
}

export interface LoadEntry {
  readonly member: string;
  readonly version: string;
  readonly startMs: number;
  readonly durationMs: number;
}

export interface StageScript {
  readonly name: string;
  readonly durationMs: number;
  readonly lines: readonly string[];
}
