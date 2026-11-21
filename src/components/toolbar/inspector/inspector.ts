import { reportBus } from "./agent-bus";
import { reportComposition } from "./agent-composition";
import { reportNetwork } from "./agent-network";
import { poster } from "./agent-post";
import { reportInteractions, reportLoads, reportVitals, supportsEventTiming } from "./agent-timing";
import { INSPECTOR_REGISTRY, type InspectorRegistry } from "./protocol";

/*
 * The frame agent (add-applications, design decision 6;
 * restore-toolbar-tools-and-branch-previews, design decision 6). The toolbar
 * runs it in a running application's framed page, in the page's own realm,
 * as soon as each new document exists, and adds it as a script on load when
 * that didn't happen. It measures and watches the page itself, then reports
 * to the toolbar in the parent page (protocol.ts), with five modules:
 *
 * - timing (agent-timing.ts): Web Vitals, load order, and interactions;
 * - hot spots: the element behind each interaction, kept weakly in the
 *   registry, for Timing's hot spots;
 * - composition (agent-composition.ts): what the page loads at run time;
 * - bus (agent-bus.ts): the page's window and document events and messages;
 * - network (agent-network.ts, add-mock-sets): its WebSocket connections and
 *   service worker registrations, which mock sets can't answer, and its id,
 *   told to the Frontend Registry's worker that controls it.
 *
 * It runs once per page, and only inside a frame, where there's a toolbar to
 * report to. Built into public/toolbar/inspector.js by
 * scripts/build-inspector.ts.
 */

type Global = typeof globalThis & { [INSPECTOR_REGISTRY]?: InspectorRegistry };

function install(): void {
  const global = globalThis as Global;
  if (global[INSPECTOR_REGISTRY] || window.parent === window) return;
  const page = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const registry: InspectorRegistry = { page, elements: new Map() };
  Object.defineProperty(global, INSPECTOR_REGISTRY, { value: registry, configurable: false, enumerable: false, writable: false });
  const post = poster(page);
  // First, so the page's earliest events are seen.
  reportBus(post);
  reportNetwork(post, page);
  const eventTiming = supportsEventTiming();
  post({ kind: "ready", eventTiming });
  reportVitals(post);
  reportLoads(post);
  reportInteractions(post, eventTiming, registry.elements);
  reportComposition(post);
}

install();
