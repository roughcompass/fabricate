import { type FabricateConfig, getConfig } from "@/lib/config";
import type { NavFlags } from "./navigation";

/** The navigation's optional areas in this configuration (server only). */
export function navFlags(config: FabricateConfig = getConfig()): NavFlags {
  return { demo: config.demoEnabled };
}
