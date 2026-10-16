import type { IconName } from "@/components/ui/icon";

/**
 * The sidebar's navigation (operator-interface/page-patterns spec, sidebar
 * navigation requirement): the top-level items, which have no sub-menu, then
 * the sections and each section's sub-menu, in groups. An item is current on
 * every path its patterns match. The patterns never overlap, so a path
 * belongs to at most one item: the general patterns exclude the create and
 * import pages, which have their own items.
 */

export interface NavItem {
  readonly id: string;
  readonly label: string;
  readonly href: string;
  readonly match: readonly RegExp[];
}

/** A run of sub-menu items. Every group after the first has a heading. */
export interface NavGroup {
  readonly label?: string;
  readonly items: readonly NavItem[];
}

/**
 * An entry of the section menu with no sub-menu (design decision 1): Home,
 * Applications, and Navigation. Every page it matches shows the section menu
 * with it marked current.
 */
export interface TopLevelItem extends NavItem {
  readonly id: "home" | "applications" | "navigation";
  readonly icon: IconName;
}

export interface NavSection {
  readonly id: "assessments" | "salt-patterns" | "prototypes";
  readonly label: string;
  readonly icon: IconName;
  /** Shown only while the template demo is enabled. */
  readonly demo?: boolean;
  /** Shown only while Prototypes is enabled, and the only section in the hosted profile. */
  readonly prototypes?: boolean;
  /** The sub-menu; choosing the section opens the first item. */
  readonly groups: readonly NavGroup[];
  /** Every item of the sub-menu, in order. */
  readonly items: readonly NavItem[];
}

const section = (definition: Omit<NavSection, "items">): NavSection => ({ ...definition, items: definition.groups.flatMap((group) => group.items) });

export const SECTIONS: readonly NavSection[] = [
  section({
    id: "assessments",
    label: "Assessments",
    icon: "checklist",
    groups: [
      {
        items: [
          { id: "all-assessments", label: "All Assessments", href: "/assessments", match: [/^\/assessments\/?$/, /^\/assessments\/(?!new\/?$)[^/]+(\/.*)?$/, /^\/(runs|evaluations|profiles)\/[^/]+(\/.*)?$/] },
          { id: "new-assessment", label: "New Assessment", href: "/assessments/new", match: [/^\/assessments\/new\/?$/] },
        ],
      },
      {
        label: "Repositories",
        items: [
          { id: "all-repositories", label: "All Repositories", href: "/repositories", match: [/^\/repositories\/?$/, /^\/repositories\/(?!(new|import)\/?$)[^/]+(\/.*)?$/] },
          { id: "new-repository", label: "New Repository", href: "/repositories/new", match: [/^\/repositories\/new\/?$/] },
          { id: "import-repositories", label: "Import Repositories", href: "/repositories/import", match: [/^\/repositories\/import\/?$/] },
        ],
      },
      {
        label: "Standards",
        items: [
          { id: "all-standards", label: "All Standards", href: "/standards", match: [/^\/standards\/?$/, /^\/standards\/(?!new\/?$)[^/]+(\/.*)?$/] },
          { id: "new-standard", label: "New Standard", href: "/standards/new", match: [/^\/standards\/new\/?$/] },
        ],
      },
    ],
  }),
  section({
    id: "salt-patterns",
    label: "Salt Patterns",
    icon: "sparkle",
    demo: true,
    groups: [
      {
        items: [
          { id: "all-salt-patterns", label: "All Salt Patterns", href: "/templates", match: [/^\/templates(\/.*)?$/] },
        ],
      },
    ],
  }),
  section({
    id: "prototypes",
    label: "Prototypes",
    icon: "flask",
    prototypes: true,
    groups: [
      {
        items: [
          // Prototype, variants, and compare pages all belong to All Prototypes; the composer and the library have their own items.
          { id: "all-prototypes", label: "All Prototypes", href: "/prototypes", match: [/^\/prototypes\/?$/, /^\/prototypes\/(?!(new|personas|lessons|shell)(\/|$))[^/]+(\/.*)?$/] },
          { id: "new-prototype", label: "New prototype", href: "/prototypes/new", match: [/^\/prototypes\/new\/?$/] },
        ],
      },
      {
        label: "Library",
        items: [
          { id: "personas", label: "Personas", href: "/prototypes/personas", match: [/^\/prototypes\/personas(\/.*)?$/] },
          { id: "lessons", label: "Lessons", href: "/prototypes/lessons", match: [/^\/prototypes\/lessons\/?$/] },
          { id: "page-shell", label: "Page shell", href: "/prototypes/shell", match: [/^\/prototypes\/shell\/?$/] },
        ],
      },
    ],
  }),
];

/** Which optional areas exist in this configuration. Pages read it from the configuration; client error pages, which can't, use NO_OPTIONAL_AREAS. */
export interface NavFlags {
  /** The template demo: Salt Patterns, and demo deployments on the Applications page. */
  readonly demo: boolean;
  readonly prototypes: boolean;
  /** The hosted profile shows only Prototypes. */
  readonly hosted: boolean;
}

export const NO_OPTIONAL_AREAS: NavFlags = { demo: false, prototypes: false, hosted: false };

/**
 * The sections to show: Assessments always, Salt Patterns while the demo is
 * enabled, and Prototypes while it is enabled. In the hosted profile, only
 * Prototypes.
 */
export function visibleSections(flags: NavFlags): readonly NavSection[] {
  if (flags.hosted) return SECTIONS.filter((section) => section.prototypes && flags.prototypes);
  return SECTIONS.filter((section) => (section.demo ? flags.demo : section.prototypes ? flags.prototypes : true));
}

/** Home (home spec): the first entry of the section menu, outside every section, so it has no sub-menu. */
export const HOME = { id: "home", label: "Home", href: "/", icon: "home", match: [/^\/$/] } as const satisfies TopLevelItem;

/** The top-level items, in order. Applications covers its dashboards, demo pages, and the Add application flow; Navigation the list, each Portal's page, and New Portal. */
export const TOP_LEVEL: readonly TopLevelItem[] = [
  HOME,
  { id: "applications", label: "Applications", href: "/applications", icon: "layers", match: [/^\/applications(\/.*)?$/] },
  { id: "navigation", label: "Navigation", href: "/navigation", icon: "network", match: [/^\/navigation(\/.*)?$/] },
];

/** The top-level items to show: all three in the full profile, none in the hosted one, which has neither Applications nor Navigation. */
export function visibleTopLevel(flags: NavFlags): readonly TopLevelItem[] {
  return flags.hosted ? [] : TOP_LEVEL;
}

/**
 * Where every link to Home leads (home spec, "Home exists only while
 * Assessments are available"): Home while Assessments is a visible section,
 * and otherwise the first visible section's first page. The product mark, the
 * section menu, the root page, and the not-found and error pages all ask here,
 * so a configuration without Assessments never links to a Home it can't show.
 */
export function homeLink(sections: readonly NavSection[]): { href: string; label: string } {
  const first = sections[0];
  if (sections.some((section) => section.id === "assessments") || !first) return { href: HOME.href, label: HOME.label };
  return { href: first.items[0]!.href, label: first.label };
}

export type Location = { kind: "item"; item: TopLevelItem } | { kind: "section"; section: NavSection; item: NavItem };

/** The top-level item, or the section and its item, a path belongs to; null for a page outside every one. */
export function locate(pathname: string, flags: NavFlags): Location | null {
  const item = visibleTopLevel(flags).find((candidate) => candidate.match.some((pattern) => pattern.test(pathname)));
  if (item) return { kind: "item", item };
  for (const section of visibleSections(flags)) {
    const found = section.items.find((candidate) => candidate.match.some((pattern) => pattern.test(pathname)));
    if (found) return { kind: "section", section, item: found };
  }
  return null;
}
