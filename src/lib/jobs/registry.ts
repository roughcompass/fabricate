import type { HandlerRegistry } from "./worker";

/**
 * Every job kind the worker runs. Handlers are registered here as the
 * assessment and evaluation pipelines are built.
 */
export function jobHandlers(): HandlerRegistry {
  return {};
}
