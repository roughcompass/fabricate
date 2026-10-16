import { APICallError, RetryError } from "ai";
import type { Failure } from "../types";

/** A failure the visitor can act on (generation spec, "Failed generations are explained"), from what a model step threw. */
export function failureFrom(error: unknown): Failure {
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
    return { kind: "timeout", message: "The model took too long and the attempt was stopped. Retry, or ask for a smaller change." };
  }
  if (APICallError.isInstance(error) || RetryError.isInstance(error) || (error instanceof Error && /^Gateway/.test(error.name))) {
    return { kind: "model", message: `The model service failed: ${error.message.slice(0, 300)}. Retry in a moment.` };
  }
  return { kind: "internal", message: `Generation failed unexpectedly: ${error instanceof Error ? error.message.slice(0, 300) : String(error)}. Retry.` };
}

/** Raised by a step to end its variant as Failed with a given reason, rather than retrying it. */
export class VariantFailure extends Error {
  override name = "VariantFailure";

  constructor(readonly failure: Failure) {
    super(failure.message);
  }
}
