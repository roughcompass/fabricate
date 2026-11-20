import type { IconName } from "@/components/ui/icon";

/**
 * The sidebar's primary menu (operator-interface/page-patterns spec): groups
 * of items under headings, set apart by dividers. An item is current on every
 * path its patterns match, its create pages and records included.
 * The patterns never overlap, so a path belongs to at most one item.
 */

export interface NavItem {
  readonly id: string;
  readonly label: string;
  readonly href: string;
  readonly icon: IconName;
  readonly match: readonly RegExp[];
}

/**
 * A run of the primary menu: the first, Home, has no heading; every other
 * group has one, and a divider sets every group after the first apart.
 */
export interface MenuGroup {
  readonly id: "main" | "registry" | "assessments" | "build" | "insights" | "admin";
  readonly heading?: string;
  readonly items: readonly NavItem[];
}

/** Home (home spec): the first entry of the primary menu. */
export const HOME = { id: "home", label: "Home", href: "/", icon: "home", match: [/^\/$/] } as const satisfies NavItem;

/** The Registry: its records, the Repositories, with their create pages, versions, and Profiles (every page of a Repository marks Repositories). */
const REPOSITORIES = { id: "repositories", label: "Repositories", href: "/repositories", icon: "git", match: [/^\/repositories(\/.*)?$/, /^\/profiles\/[^/]+(\/.*)?$/] } as const satisfies NavItem;

/** Applications (add-applications), after Repositories: the gallery, onboarding, each application's page, and its preview mode. */
export const APPLICATIONS = { id: "applications", label: "Applications", href: "/applications", icon: "frame", match: [/^\/applications(\/.*)?$/] } as const satisfies NavItem;

/** Assessments' pages, each list with its create pages and its records. */
const ASSESSMENT_ITEMS: readonly NavItem[] = [
  { id: "all-assessments", label: "All Assessments", href: "/assessments", icon: "checklist", match: [/^\/assessments(\/.*)?$/, /^\/(runs|evaluations)\/[^/]+(\/.*)?$/] },
  { id: "standards", label: "Standards", href: "/standards", icon: "target", match: [/^\/standards(\/.*)?$/] },
];

/** Admin: how the Frontend Registry's parts stand, and settings it keeps for every operator, such as Bitbucket Server tokens. */
const ADMIN_ITEMS: readonly NavItem[] = [
  { id: "system", label: "System", href: "/admin/system", icon: "monitor", match: [/^\/admin(\/system)?\/?$/] },
  { id: "bitbucket-tokens", label: "Bitbucket tokens", href: "/admin/bitbucket-tokens", icon: "lock", match: [/^\/admin\/bitbucket-tokens(\/.*)?$/] },
];

/** Insights: Adoption Analytics, how the fleet uses the design systems and packages the Reference Catalog describes. */
const INSIGHTS_ITEMS: readonly NavItem[] = [{ id: "adoption", label: "Adoption", href: "/adoption", icon: "grid", match: [/^\/adoption(\/.*)?$/] }];

/** Which optional areas exist in this configuration. Pages read it from the configuration; client error pages, which can't, use NO_OPTIONAL_AREAS. */
export interface NavFlags {
  /** Applications, which are offered while previews are enabled (applications/onboarding spec). */
  readonly applications: boolean;
}

export const NO_OPTIONAL_AREAS: NavFlags = { applications: false };

/**
 * The primary menu's groups (page-patterns spec, "The primary menu leads
 * with the Registry and its Applications"): Home; the Registry, with
 * Repositories, and Applications while applications are offered;
 * Assessments; Insights; and Admin last.
 */
export function visibleGroups(flags: NavFlags): readonly MenuGroup[] {
  return [
    { id: "main", items: [HOME] },
    { id: "registry", heading: "Registry", items: flags.applications ? [REPOSITORIES, APPLICATIONS] : [REPOSITORIES] },
    { id: "assessments", heading: "Assessments", items: ASSESSMENT_ITEMS },
    { id: "insights", heading: "Insights", items: INSIGHTS_ITEMS },
    { id: "admin", heading: "Admin", items: ADMIN_ITEMS },
  ];
}

export interface Location {
  readonly group: MenuGroup;
  readonly item: NavItem;
}

/** The menu item a path belongs to, and its group; null for a page outside every one. */
export function locate(pathname: string, flags: NavFlags): Location | null {
  for (const group of visibleGroups(flags)) {
    // Home is in the menu only while it's available.
    const item = group.items.find((candidate) => candidate.match.some((pattern) => pattern.test(pathname)));
    if (item) return { group, item };
  }
  return null;
}
