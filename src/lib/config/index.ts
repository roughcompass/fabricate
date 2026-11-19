import { type FrontendRegistryConfig, loadConfig } from "./configuration";

export * from "./configuration";

const holder = globalThis as typeof globalThis & { __frontendRegistryConfig?: FrontendRegistryConfig };

/** The process-wide configuration, loaded and validated on first use. */
export function getConfig(): FrontendRegistryConfig {
  return (holder.__frontendRegistryConfig ??= loadConfig());
}

/** Replaces the process-wide configuration (tests only).
 * @public Tests and end-to-end runs replace the configuration through this.
 */
export function setConfig(config: FrontendRegistryConfig | undefined): void {
  holder.__frontendRegistryConfig = config;
}
