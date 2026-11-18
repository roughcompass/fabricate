import type { IconName } from "@/components/ui/icon";

/**
 * The sidebar's primary menu (operator-interface/page-patterns spec): groups
 * of items under headings, set apart by dividers. An item is current on every
 * path its patterns match, its create and import pages and records included.
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
 * A run of the primary menu: the first has no heading; Assessments and
 * Templates each have a heading, and a divider sets every group after the
 * first apart.
 */
export interface MenuGroup {
  readonly id: "main" | "assessments" | "build";
  readonly heading?: string;
  readonly items: readonly NavItem[];
}

/** Home (home spec): the first entry of the primary menu. */
export const HOME = { id: "home", label: "Home", href: "/", icon: "home", match: [/^\/$/] } as const satisfies NavItem;

/** Assessments' pages, each list with its create and import pages and its records. */
const ASSESSMENT_ITEMS: readonly NavItem[] = [
  { id: "all-assessments", label: "All Assessments", href: "/assessments", icon: "checklist", match: [/^\/assessments(\/.*)?$/, /^\/(runs|evaluations|profiles)\/[^/]+(\/.*)?$/] },
  { id: "repositories", label: "Repositories", href: "/repositories", icon: "git", match: [/^\/repositories(\/.*)?$/] },
  { id: "standards", label: "Standards", href: "/standards", icon: "target", match: [/^\/standards(\/.*)?$/] },
];

export const SALT_PATTERNS = { id: "salt-patterns", label: "Salt Patterns", href: "/templates", icon: "sparkle", match: [/^\/templates(\/.*)?$/] } as const satisfies NavItem;

/** Which optional areas exist in this configuration. Pages read it from the configuration; client error pages, which can't, use NO_OPTIONAL_AREAS. */
export interface NavFlags {
  /** The template demo: Salt Patterns. */
  readonly demo: boolean;
}

export const NO_OPTIONAL_AREAS: NavFlags = { demo: false };

/**
 * The primary menu's groups (page-patterns spec, "The primary menu groups
 * areas under headings and dividers"): Home; Assessments; then Salt
 * Patterns, under Templates, while the demo is enabled.
 */
export function visibleGroups(flags: NavFlags): readonly MenuGroup[] {
  return [{ id: "main", items: [HOME] }, { id: "assessments", heading: "Assessments", items: ASSESSMENT_ITEMS }, ...(flags.demo ? [{ id: "build", heading: "Templates", items: [SALT_PATTERNS] } as const] : [])];
}

/** Every item of the menu, in order. */
export function menuItems(groups: readonly MenuGroup[]): readonly NavItem[] {
  return groups.flatMap((group) => group.items);
}

/**
 * Where every link to Home leads (home spec, "Home exists only while
 * Assessments are available"): Home while the Assessments group is shown,
 * and otherwise the menu's first page. The product mark, the menu, the root
 * page, and the not-found and error pages all ask here, so a configuration
 * without Assessments never links to a Home it can't show.
 */
export function homeLink(groups: readonly MenuGroup[]): { href: string; label: string } {
  const first = groups[0]?.items[0];
  if (groups.some((group) => group.id === "assessments") || !first) return { href: HOME.href, label: HOME.label };
  return { href: first.href, label: first.label };
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
