// Removes credentials from Git diagnostics before they leave GitRunner.
const MAX_LENGTH = 2_000;

const PATTERNS: readonly [RegExp, string][] = [
  [/([a-z][a-z0-9+.-]*:\/\/)[^/\s@]+@/gi, "$1[REDACTED]@"],
  [/(authorization:\s*)[^\r\n]+/gi, "$1[REDACTED]"],
  [/\b(?:gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{16,}|glpat-[A-Za-z0-9_-]{16,}|xox[abprs]-[A-Za-z0-9-]+)\b/g, "[REDACTED]"],
  [/\b((?:access_)?token|password|passwd|secret|private_token)=[^&\s]+/gi, "$1=[REDACTED]"],
];

export function redact(text: string): string {
  let redacted = text.toWellFormed();
  for (const [pattern, replacement] of PATTERNS) redacted = redacted.replace(pattern, replacement);
  return redacted.length > MAX_LENGTH ? `${redacted.slice(0, MAX_LENGTH)}…` : redacted;
}
