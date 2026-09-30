export type GitErrorCode =
  | "command_rejected"
  | "git_unavailable"
  | "git_unsupported"
  | "timeout"
  | "canceled"
  | "output_limit_exceeded"
  | "command_failed";

/**
 * Every failure raised by GitRunner. Messages and stderr are redacted before
 * the error is constructed, so they are safe to log or persist.
 */
export class GitError extends Error {
  override name = "GitError";

  constructor(
    readonly code: GitErrorCode,
    message: string,
    readonly exitCode: number | null = null,
    readonly stderr = "",
  ) {
    super(message);
  }
}
