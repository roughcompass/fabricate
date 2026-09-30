import { type FabricateConfig, loadConfig } from "./configuration";

export * from "./configuration";

const holder = globalThis as typeof globalThis & { __fabricateConfig?: FabricateConfig };

/** The process-wide configuration, loaded and validated on first use. */
export function getConfig(): FabricateConfig {
  return (holder.__fabricateConfig ??= loadConfig());
}

/** Replaces the process-wide configuration (tests only). */
export function setConfig(config: FabricateConfig | undefined): void {
  holder.__fabricateConfig = config;
}
