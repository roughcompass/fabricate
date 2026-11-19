import { applicationsAvailable } from "@/lib/applications/availability";
import { type FrontendRegistryConfig, getConfig } from "@/lib/config";
import type { NavFlags } from "./navigation";

/**
 * Whether the menu lists Applications yet. The Applications page offers New
 * application, whose onboarding page comes with add-applications task 5.1;
 * until then the item stays out of the menu, so that every link the menu
 * leads to opens a page (page-patterns spec, "Links open the pages they name").
 */
const ONBOARDING_PAGE = false;

/** The navigation's optional areas in this configuration (server only): the template demo, and Applications while previews are enabled. */
export function navFlags(config: FrontendRegistryConfig = getConfig()): NavFlags {
  return { demo: config.demoEnabled, applications: ONBOARDING_PAGE && applicationsAvailable(config) };
}
