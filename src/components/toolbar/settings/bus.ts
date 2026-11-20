import type { BusEntry, BusKind } from "../inspector/protocol";

/*
 * Settings' event bus (restore-toolbar-tools-and-branch-previews, design
 * decision 6): the log's rules and the Send an event form's checks. No React
 * or browser dependencies, so they can be tested directly.
 */

/** Entries the log keeps, newest first. */
export const BUS_LIMIT = 200;

export const BUS_KIND_LABELS: Record<BusKind, string> = {
  window: "Window event",
  document: "Document event",
  message: "Message received",
  posted: "Message to this page",
};

/** How an event can be sent from the form. */
export const SEND_TARGETS = ["window", "document", "message"] as const;
export type SendTarget = (typeof SEND_TARGETS)[number];

export const SEND_TARGET_LABELS: Record<SendTarget, string> = { window: "Event on window", document: "Event on document", message: "Message to the page" };

const NAME_LIMIT = 100;

/** +log+ with +entry+ added: newest first, at most 200, an entry reported again kept once. */
export function addEntry(log: readonly BusEntry[], entry: BusEntry): BusEntry[] {
  if (log.some((known) => known.kind === entry.kind && known.id === entry.id)) return [...log];
  return [entry, ...log].sort((left, right) => right.timeMs - left.timeMs).slice(0, BUS_LIMIT);
}

/** An entry's time since the page loaded: `+1.23 s`. */
export function busTime(ms: number): string {
  return `+${(ms / 1000).toFixed(2)} s`;
}

export interface SendFields {
  readonly target: SendTarget;
  readonly name: string;
  readonly detail: string;
}

export type SendErrors = { name?: string[]; detail?: string[] };

/** The form's fields checked: the detail parsed, or why it and the name can't be sent. */
export function checkSend(fields: SendFields): { ok: true; name: string; detail: unknown } | { ok: false; errors: SendErrors } {
  const errors: SendErrors = {};
  const name = fields.name.trim();
  if (fields.target !== "message") {
    if (!name) errors.name = ["Enter an event name, such as quotes:selected."];
    else if (/\s/.test(name)) errors.name = ["An event name can't contain spaces."];
    else if (name.length > NAME_LIMIT) errors.name = [`An event name can have up to ${NAME_LIMIT} characters.`];
  }
  let detail: unknown = null;
  try {
    detail = JSON.parse(fields.detail.trim() || "{}");
  } catch {
    errors.detail = ['The detail must be JSON, such as {"symbol": "EURUSD"}.'];
  }
  return errors.name || errors.detail ? { ok: false, errors } : { ok: true, name, detail };
}
