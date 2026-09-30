import { ValidationError } from "@/lib/db/errors";

/** Runs +work+ and returns the ValidationError it throws. */
export function captureValidation(work: () => unknown): ValidationError {
  try {
    work();
  } catch (error) {
    if (error instanceof ValidationError) return error;
    throw error;
  }
  throw new Error("expected a ValidationError");
}
