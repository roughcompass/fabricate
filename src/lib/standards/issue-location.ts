/**
 * Where a Standard validation issue is, in words: "Control 1 (has-ci) · Key".
 * The editor lists these locations (the messages stay beside their fields),
 * and the publication review lists them with their messages.
 */

export interface LocatedIssue {
  field: string;
  message: string;
}

const PARTS: Record<string, string> = {
  applicability: "Applies when",
  condition: "Expected condition",
  key: "Key",
  title: "Title",
  rationale: "Rationale",
  severity: "Severity",
  subject: "Subject",
  guidance: "Guidance",
};

function words(field: string): string {
  const text = field.replaceAll("_", " ").replace(/[.[\]]+/g, " ").trim();
  return text ? text[0]!.toUpperCase() + text.slice(1) : "The draft";
}

/** The readable location of a validation path, using the Controls' current keys. */
export function issueLocation(field: string, controls: readonly { key?: unknown }[]): string {
  const match = /^controls\[(\d+)\](?:\.(\w+))?/.exec(field);
  if (!match) return words(field);
  const index = Number(match[1]);
  const key = controls[index]?.key;
  const control = `Control ${index + 1}${typeof key === "string" && key ? ` (${key})` : ""}`;
  const part = match[2] ? (PARTS[match[2]] ?? words(match[2])) : null;
  return part ? `${control} · ${part}` : control;
}

/** A location and its message, for a list where the fields are not shown. */
export function describeIssue(issue: LocatedIssue, controls: readonly { key?: unknown }[]): string {
  return `${issueLocation(issue.field, controls)}: ${issue.message}`;
}
