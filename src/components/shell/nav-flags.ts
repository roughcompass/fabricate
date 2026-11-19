import { applicationsAvailable } from "@/lib/applications/availability";
import { type FrontendRegistryConfig, getConfig } from "@/lib/config";
import type { NavFlags } from "./navigation";

/**
 * Whether the menu lists Applications yet. Its page, /applications, comes
 * with add-applications' Applications page (task 6.1); until then the item
 * stays out of the menu, so that every menu link opens a page (page-patterns
 * spec, "Links open the pages they name"). When the page lands, this goes,
 * and the item shows whenever applications are offered.
 */
const APPLICATIONS_PAGE = false;

/** The navigation's optional areas in this configuration (server only). */
export function navFlags(config: FrontendRegistryConfig = getConfig()): NavFlags {
  return { demo: config.demoEnabled, applications: APPLICATIONS_PAGE && applicationsAvailable(config) };
}
