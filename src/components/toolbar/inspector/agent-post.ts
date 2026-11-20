import { INSPECTOR_MESSAGE, type InspectorMessage } from "./protocol";

/** A message as the agent's modules write it: its type tag and page are added when it's posted. */
export type Untagged = InspectorMessage extends infer Message ? (Message extends unknown ? Omit<Message, "type" | "page"> : never) : never;

export type Post = (message: Untagged) => void;

/** Posts to the toolbar in the parent page, on this page's own origin only, tagged with this load of the page. */
export function poster(page: string): Post {
  return (message) => window.parent.postMessage({ type: INSPECTOR_MESSAGE, page, ...message }, window.location.origin);
}

export function truncate(text: string, length: number): string {
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

/** The longest detail an event bus entry keeps. */
const DETAIL_LIMIT = 2000;
const DEPTH_LIMIT = 6;

/**
 * +value+ as JSON text for the event bus log, whatever it holds: functions
 * are left out, elements, windows, and events are named, a value met again
 * inside itself reads "[Circular]", and anything deeper than six levels
 * "[…]". The text is shortened past 2,000 characters. It never throws.
 */
export function describeValue(value: unknown): string {
  const seen = new WeakSet<object>();
  const simplify = (item: unknown, depth: number): unknown => {
    if (item === undefined || typeof item === "function" || typeof item === "symbol") return undefined;
    if (typeof item === "bigint") return `${item}n`;
    if (item === null || typeof item !== "object") return item;
    if (seen.has(item)) return "[Circular]";
    if (depth >= DEPTH_LIMIT) return "[…]";
    const tag = Object.prototype.toString.call(item);
    if (tag === "[object Window]" || tag === "[object global]") return "[Window]";
    if ("nodeType" in item && "nodeName" in item) return `<${String((item as Node).nodeName).toLowerCase()}>`;
    if ("type" in item && "timeStamp" in item && "isTrusted" in item) return `[Event ${(item as Event).type}]`;
    seen.add(item);
    if (Array.isArray(item)) return item.map((entry) => simplify(entry, depth + 1) ?? null);
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(item)) {
      const entry = simplify((item as Record<string, unknown>)[key], depth + 1);
      if (entry !== undefined) result[key] = entry;
    }
    return result;
  };
  try {
    const text = JSON.stringify(simplify(value, 0)) ?? "null";
    return truncate(text, DETAIL_LIMIT);
  } catch {
    return "null";
  }
}
