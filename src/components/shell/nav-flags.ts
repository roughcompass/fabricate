import { type FrontendRegistryConfig, getConfig } from "@/lib/config";
import type { NavFlags } from "./navigation";

/** The navigation's optional areas in this configuration (server only). */
export function navFlags(config: FrontendRegistryConfig = getConfig()): NavFlags {
  return { demo: config.demoEnabled };
}
