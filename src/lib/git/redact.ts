// Removes credentials from Git diagnostics before they leave GitRunner, and from build logs and failure reasons wherever they're shown.
const MAX_LENGTH = 2_000;

const PATTERNS: readonly [RegExp, string][] = [
  // Credentials in a URL: https://user:token@host, ssh://user@host keeps only the host.
  [/([a-z][a-z0-9+.-]*:\/\/)[^/\s@]+@/gi, "$1[REDACTED]@"],
  // An Authorization header, and a Bearer or Basic credential anywhere else, such as in JSON; a word after "Basic" in prose has no digits or base64 padding.
  [/(authorization:\s*)[^\r\n]+/gi, "$1[REDACTED]"],
  [/\b(Bearer|Basic)\s+(?=[A-Za-z0-9._~+/-]*[0-9+/=])[A-Za-z0-9._~+/-]{8,}=*/g, "$1 [REDACTED]"],
  // npm's .npmrc credentials, alone or scoped to a registry (//registry.example.com/:_authToken=…), and Yarn's npmAuthToken and npmAuthIdent.
  // A value runs up to whitespace, a quote, or an & that ends it.
  [/(_auth(?:Token)?|_password)(\s*=\s*)("?)[^\s"'&]+/gi, "$1$2$3[REDACTED]"],
  [/(npmAuth(?:Token|Ident)["']?\s*[:=]\s*["']?)[^\s"'&]+/gi, "$1[REDACTED]"],
  // Tokens by their shape: npm, GitHub, GitLab, and Slack.
  [/\b(?:npm_[A-Za-z0-9]{36}|gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{16,}|glpat-[A-Za-z0-9_-]{16,}|xox[abprs]-[A-Za-z0-9-]+)\b/g, "[REDACTED]"],
  // A token, password, secret, or API key assigned with =, such as token=… in a query or NPM_TOKEN=… in an environment.
  [/\b([A-Za-z0-9_]*(?:token|password|passwd|secret|api_?key))=[^&\s]+/gi, "$1=[REDACTED]"],
];

/** A thrown value in words for a record or log: an Error's message, or the value itself, redacted and at most +limit+ characters. */
export function failureText(error: unknown, limit = MAX_LENGTH): string {
  const text = redact(error instanceof Error ? error.message : String(error));
  return text.length > limit ? text.slice(0, limit) : text;
}

/** +text+ redacted and at most MAX_LENGTH characters, for a diagnostic or a reason. */
export function redact(text: string): string {
  const redacted = redactSecrets(text);
  return redacted.length > MAX_LENGTH ? `${redacted.slice(0, MAX_LENGTH)}…` : redacted;
}

/** +text+ with everything that looks like a credential replaced by [REDACTED], at its full length, for a build log as it's written and as it's read. */
export function redactSecrets(text: string): string {
  let redacted = text.toWellFormed();
  for (const [pattern, replacement] of PATTERNS) redacted = redacted.replace(pattern, replacement);
  return redacted;
}
