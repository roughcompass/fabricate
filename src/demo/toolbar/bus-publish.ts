/** Validation for messages published from the toolbar's Settings tool. */

const TOPIC_PATTERN = /^[a-z][a-z0-9-]*(:[a-z0-9-]+)*$/;
const TOPIC_LIMIT = 60;

/** Parses a payload the visitor typed, or explains why it is not JSON. */
export function parsePayload(text: string): { ok: true; payload: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, payload: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, error: 'The payload must be valid JSON, such as {"symbol": "ACME"}.' };
  }
}

/** Explains why a topic name is not usable, or returns null when it is. */
export function topicError(topic: string): string | null {
  return TOPIC_PATTERN.test(topic) && topic.length <= TOPIC_LIMIT ? null : "Enter a topic of lowercase words separated by colons, such as instrument:selected.";
}
