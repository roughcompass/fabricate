/**
 * The Repository Profile's views, each answering one question, and the
 * categories each holds. Every category is in exactly one view, so every fact
 * has one place, and a link to a category opens the view that holds it.
 *
 * Views a frontend web repository needs, such as Design system, are hidden
 * for any other repository, whose Overview says why (kind.ts).
 */

export const PROFILE_TABS = [
  { id: "overview", label: "Overview", question: "What it is, and what needs attention", categories: [], frontendOnly: false },
  { id: "composition", label: "Composition", question: "How it fits into the web runtime", categories: ["composition", "served_origins", "runtime_integrations"], frontendOnly: true },
  { id: "dependencies", label: "Dependencies", question: "What it depends on, and what it produces", categories: ["frameworks", "dependencies", "resolved_dependencies", "packages_consumed", "packages_produced", "package_identity", "workspaces", "submodules"], frontendOnly: false },
  { id: "design-system", label: "Design system", question: "Which design system it uses, and where it writes its own HTML and CSS", categories: ["design_systems", "ui_elements", "style_values"], frontendOnly: true },
  { id: "services", label: "Services", question: "Which services it calls, and how", categories: ["api_contracts", "egress_routes", "access_signals", "test_substitutes"], frontendOnly: false },
  { id: "tooling", label: "Tooling", question: "How it's built, tested, and delivered", categories: ["languages", "package_managers", "build_tools", "test_frameworks", "ci_systems", "scripts", "verification_commands", "runtime_requirements"], frontendOnly: false },
  { id: "diagnostics", label: "Diagnostics", question: "What the Profile couldn't establish, and what it read", categories: [], frontendOnly: false },
] as const satisfies readonly { id: string; label: string; question: string; categories: readonly string[]; frontendOnly: boolean }[];

export type ProfileTabId = (typeof PROFILE_TABS)[number]["id"];

const BY_CATEGORY = new Map<string, ProfileTabId>(PROFILE_TABS.flatMap((tab) => tab.categories.map((category): [string, ProfileTabId] => [category, tab.id])));
// Sections that aren't categories.
const SECTIONS: Record<string, ProfileTabId> = { overview: "overview", attention: "overview", services: "services", diagnostics: "diagnostics", "other-diagnostics": "diagnostics", "needs-attention": "diagnostics", details: "diagnostics", relationships: "composition" };

/** The view that holds +section+: a category id, or a section such as `services`. An extension category is shown with Tooling. */
export function tabOf(section: string): ProfileTabId {
  return BY_CATEGORY.get(section) ?? SECTIONS[section] ?? "tooling";
}

export function isProfileTab(value: string | undefined): value is ProfileTabId {
  return PROFILE_TABS.some((tab) => tab.id === value);
}

/** The address of a view of the Profile at +base+, keeping +query+'s other values. The Overview is the Profile's own address. */
export function profileTabHref(base: string, tab: ProfileTabId, hash?: string): string {
  const params = new URLSearchParams(tab === "overview" ? {} : { tab });
  return `${base}${params.size ? `?${params}` : ""}${hash ? `#${hash}` : ""}`;
}

/** A link to a section of the Profile at +base+: the view that holds it, at the section. */
export function profileSectionHref(base: string, section: string): string {
  const tab = tabOf(section);
  return profileTabHref(base, tab, tab === "overview" && section === "overview" ? undefined : section);
}
