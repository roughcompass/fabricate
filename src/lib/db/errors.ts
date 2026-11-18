/** One field-addressed problem with submitted data. */
export interface Issue {
  field: string;
  message: string;
}

/** Raised when submitted data is invalid. Carries every problem, not the first. */
export class ValidationError extends Error {
  override name = "ValidationError";

  constructor(readonly issues: readonly Issue[]) {
    super(issues.map((issue) => `${issue.field}: ${issue.message}`).join("; "));
  }

  messagesFor(field: string): string[] {
    return this.issues.filter((issue) => issue.field === field).map((issue) => issue.message);
  }
}

/** Raised when an optimistic-locked record changed since the caller read it. */
export class StaleRecordError extends Error {
  override name = "StaleRecordError";
}

export class NotFoundError extends Error {
  override name = "NotFoundError";
}

/** Raised when a state transition is not allowed or a terminal record would change. */
export class TransitionError extends Error {
  override name = "TransitionError";
}

/** Collects issues and throws them together. */
export class IssueCollector {
  readonly issues: Issue[] = [];

  add(field: string, message: string): void {
    this.issues.push({ field, message });
  }

  throwIfAny(): void {
    if (this.issues.length) throw new ValidationError(this.issues);
  }
}

export function isUniqueViolation(error: unknown): error is Error & { code: string } {
  const code = (error as { code?: string } | null)?.code;
  return error instanceof Error && (code === "SQLITE_CONSTRAINT_UNIQUE" || code === "SQLITE_CONSTRAINT_PRIMARYKEY");
}
