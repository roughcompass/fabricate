import { CONFIGURATION_SECTIONS } from "@/lib/experience/sections";
import { PORTALS_HREF, configurationHref, editorHref, portalHref } from "@/lib/portals/paths";

/*
 * The Runtime Configuration sub-menu (runtime-configuration spec, "The
 * Runtime Configuration sub-menu lists the Portal's pages"): All Portals,
 * then, on a Portal's pages, that Portal's Experience Editor and Portal page
 * under its name, then its configuration sections under their group
 * headings. Built from the address alone, so the sidebar needs nothing else.
 */

export interface SubmenuItem {
  readonly id: string;
  readonly label: string;
  readonly href: string;
}

export interface SubmenuGroup {
  readonly id: string;
  readonly heading?: string;
  readonly items: readonly SubmenuItem[];
}

export interface RuntimeMenu {
  /** The Portal whose pages are open, or null on the Portals page. */
  readonly portalId: string | null;
  /** The item the page marks current. */
  readonly current: string;
  readonly groups: readonly SubmenuGroup[];
}

/** The configuration sections' first group has no caption of its own in the editor; in the sub-menu it's Identity. */
const FIRST_GROUP = "Identity";

const PORTAL_PAGE = /^\/portals\/(ptl_[a-z0-9]+)(?:\/([^?#]*))?\/?$/;

/** The sub-menu for +pathname+, with +portalName+ heading the Portal's own items. */
export function runtimeMenu(pathname: string, portalName: (portalId: string) => string | null = () => null): RuntimeMenu {
  const allPortals: SubmenuGroup = { id: "all", items: [{ id: "all-portals", label: "All Portals", href: PORTALS_HREF }] };
  const match = PORTAL_PAGE.exec(pathname);
  if (!match) return { portalId: null, current: "all-portals", groups: [allPortals] };
  const portalId = match[1]!;
  const rest = match[2] ?? "";
  const current = rest.startsWith("editor") ? "editor" : rest.startsWith("configuration/") ? rest.split("/")[1]! : "portal";

  const sections = new Map<string, SubmenuItem[]>();
  for (const section of CONFIGURATION_SECTIONS) {
    const heading = section.group ?? FIRST_GROUP;
    sections.set(heading, [...(sections.get(heading) ?? []), { id: section.id, label: section.name, href: configurationHref(portalId, section.id) }]);
  }
  return {
    portalId,
    current,
    groups: [
      allPortals,
      {
        id: "portal",
        heading: portalName(portalId) ?? "This Portal",
        items: [
          { id: "editor", label: "Experience Editor", href: editorHref(portalId) },
          { id: "portal", label: "Portal", href: portalHref(portalId) },
        ],
      },
      ...[...sections].map(([heading, items]) => ({ id: heading.toLowerCase().replace(/[^a-z]+/g, "-"), heading, items })),
    ],
  };
}
