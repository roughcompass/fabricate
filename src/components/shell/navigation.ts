import type { IconName } from "@/components/ui/icon";

/**
 * The sidebar's navigation (operator-interface/page-patterns spec, sidebar
 * navigation requirement): the top-level sections and each section's
 * sub-menu. An item is current on every path its patterns match. The patterns
 * never overlap, so a path belongs to at most one item: the general patterns
 * exclude the create and import pages, which have their own items.
 */

export interface NavItem {
  readonly id: string;
  readonly label: string;
  readonly href: string;
  readonly match: readonly RegExp[];
}

export interface NavSection {
  readonly id: "initiatives" | "sources" | "standards" | "templates";
  readonly label: string;
  readonly icon: IconName;
  /** Shown only while the template demo is enabled. */
  readonly demo?: boolean;
  /** The sub-menu; choosing the section opens the first item. */
  readonly items: readonly NavItem[];
}

export const SECTIONS: readonly NavSection[] = [
  {
    id: "initiatives",
    label: "Initiatives",
    icon: "layers",
    items: [
      { id: "all-initiatives", label: "All Initiatives", href: "/", match: [/^\/$/, /^\/initiatives\/?$/, /^\/initiatives\/(?!new\/?$)[^/]+(\/.*)?$/, /^\/(assessments|evaluations|profiles)\/[^/]+(\/.*)?$/] },
      { id: "new-initiative", label: "New Initiative", href: "/initiatives/new", match: [/^\/initiatives\/new\/?$/] },
    ],
  },
  {
    id: "sources",
    label: "Sources",
    icon: "git",
    items: [
      { id: "all-sources", label: "All Sources", href: "/sources", match: [/^\/sources\/?$/, /^\/sources\/(?!(new|import)\/?$)[^/]+(\/.*)?$/] },
      { id: "add-source", label: "Add Source", href: "/sources/new", match: [/^\/sources\/new\/?$/] },
      { id: "import-sources", label: "Import Sources", href: "/sources/import", match: [/^\/sources\/import\/?$/] },
    ],
  },
  {
    id: "standards",
    label: "Standards",
    icon: "checklist",
    items: [
      { id: "all-standards", label: "All Standards", href: "/standards", match: [/^\/standards\/?$/, /^\/standards\/(?!new\/?$)[^/]+(\/.*)?$/] },
      { id: "new-standard", label: "New Standard", href: "/standards/new", match: [/^\/standards\/new\/?$/] },
    ],
  },
  {
    id: "templates",
    label: "Templates",
    icon: "sparkle",
    demo: true,
    items: [
      { id: "new-application", label: "New application", href: "/new", match: [/^\/new(\/.*)?$/] },
      { id: "gallery", label: "Gallery", href: "/templates", match: [/^\/templates(\/.*)?$/] },
      { id: "applications", label: "Applications", href: "/applications", match: [/^\/applications(\/.*)?$/] },
    ],
  },
];

/** The sections to show: Templates only while the demo is enabled. */
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
