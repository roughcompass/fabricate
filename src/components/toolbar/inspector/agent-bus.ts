import { type Post, describeValue } from "./agent-post";
import { type BusEntry, isInspectorMessage, isToolbarEvent } from "./protocol";

/*
 * The agent's event bus module: the events the page dispatches on its window
 * and document, and the messages its window receives. It wraps
 * EventTarget.prototype.dispatchEvent in the page's realm, once, and records
 * each event a script dispatched (not the browser's own) on the window or
 * the document before passing it on; the wrapper returns what the original
 * returns, and throws what it throws. Events dispatched before the agent ran
 * aren't seen, nor are events on other elements, broadcast channels, or
 * buses kept in JavaScript objects.
 */

export function reportBus(post: Post): void {
  let nextId = 1;
  const record = (entry: Omit<BusEntry, "id" | "timeMs">) => post({ kind: "bus", entry: { id: nextId++, timeMs: performance.now(), ...entry } });

  const original = EventTarget.prototype.dispatchEvent;
  EventTarget.prototype.dispatchEvent = function dispatchEvent(this: EventTarget, event: Event): boolean {
    if ((this === window || this === document) && event && !event.isTrusted) {
      try {
        record({ kind: this === window ? "window" : "document", name: event.type, detail: describeValue((event as CustomEvent).detail ?? (event as PopStateEvent).state ?? null), from: isToolbarEvent(event) ? "toolbar" : "application" });
      } catch {
        // Logging must never change what the page's own dispatch does.
      }
    }
    return original.call(this, event);
  };

  window.addEventListener("message", (event) => {
    // The agent's own messages go to the parent, and the toolbar's commands to the agent aren't the page's.
    if (isInspectorMessage(event.data)) return;
    record({ kind: "message", name: "message", detail: describeValue(event.data), from: event.source === window.parent ? "toolbar" : "application" });
  });
}
