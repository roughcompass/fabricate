import type { IconName } from "@/components/ui/icon";

/**
 * The sidebar's navigation (operator-interface/page-patterns spec, sidebar
 * navigation requirement): the top-level sections and each section's
 * sub-menu, in groups. An item is current on every path its patterns match.
 * The patterns never overlap, so a path belongs to at most one item: the
 * general patterns exclude the create and import pages, which have their own
 * items.
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

export interface NavSection {
  readonly id: "assessments" | "applications" | "salt-patterns";
  readonly label: string;
  readonly icon: IconName;
  /** Shown only while the template demo is enabled. */
  readonly demo?: boolean;
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
    id: "applications",
    label: "Applications",
    icon: "layers",
    demo: true,
    groups: [
      {
        items: [
          { id: "all-applications", label: "All Applications", href: "/applications", match: [/^\/applications\/?$/, /^\/applications\/(?!import(\/|$))[^/]+(\/.*)?$/] },
          { id: "import-bitbucket", label: "Import from BitBucket", href: "/applications/import", match: [/^\/applications\/import(\/.*)?$/] },
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
          { id: "new-application", label: "New application", href: "/new", match: [/^\/new\/?$/] },
        ],
      },
    ],
  }),
];

/** The sections to show: Applications and Salt Patterns only while the demo is enabled. */
export function visibleSections(demoEnabled: boolean): readonly NavSection[] {
  return SECTIONS.filter((section) => demoEnabled || !section.demo);
}

/** The section and item a path belongs to, or null for a page outside every section. */
export function locate(pathname: string, demoEnabled: boolean): { section: NavSection; item: NavItem } | null {
  for (const section of visibleSections(demoEnabled)) {
    const item = section.items.find((candidate) => candidate.match.some((pattern) => pattern.test(pathname)));
    if (item) return { section, item };
  }
  return null;
}
