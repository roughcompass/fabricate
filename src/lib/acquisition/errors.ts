/**
 * Normalized, source-specific acquisition failures. Codes are stable and
 * machine-readable; messages are redacted and safe to persist on the target.
 */
export type AcquisitionFailureCode =
  | "boundary_violation"
  | "source_unavailable"
  | "authentication_failed"
  | "invalid_ref"
  | "ambiguous_ref"
  | "timeout"
  | "canceled"
  | "lock_timeout"
  | "git_unavailable"
  | "object_verification_failed"
  | "unsupported_repository"
  | "unexpected";

export class AcquisitionError extends Error {
  override name = "AcquisitionError";

  constructor(
    readonly code: AcquisitionFailureCode,
    message: string,
  ) {
    super(message);
  }
}
