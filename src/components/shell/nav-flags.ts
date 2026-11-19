import { applicationsAvailable } from "@/lib/applications/availability";
import { type FrontendRegistryConfig, getConfig } from "@/lib/config";
import type { NavFlags } from "./navigation";

/** The navigation's optional areas in this configuration (server only): the template demo, and Applications while previews are enabled. */
export function navFlags(config: FrontendRegistryConfig = getConfig()): NavFlags {
  return { demo: config.demoEnabled, applications: applicationsAvailable(config) };
}
