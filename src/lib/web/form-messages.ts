/** Every distinct message in a form state, for the error summary. */
export function allMessages(errors: Partial<Record<string, string[]>>): string[] {
  return [...new Set(Object.values(errors).flatMap((messages) => messages ?? []))];
}
