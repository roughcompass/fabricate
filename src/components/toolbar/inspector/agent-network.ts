import { MOCKS_CHANNEL, type PageAnnouncement } from "../routing/mock-log";
import { ROUTING_WORKER_SCRIPT } from "../routing/table";
import type { Post } from "./agent-post";
import type { InspectedSocket, SocketState } from "./protocol";

/*
 * The agent's network module (add-mock-sets, design decision 3): what mock
 * sets can't answer, observed without being changed, so Data can say so.
 *
 * - WebSocket connections: the page's WebSocket constructor is wrapped in a
 *   Proxy whose construct trap makes a real WebSocket and returns it, so
 *   `instanceof`, the constants, and subclasses work as before. Each
 *   connection's address is reported, then whether it opened, closed, or
 *   failed before opening; never its messages.
 * - Service worker registrations: ServiceWorkerContainer.prototype.register
 *   reports each registration's script and scope, then calls the original
 *   and returns what it returns. A build's own worker for its path replaces
 *   the Frontend Registry's, so mock sets stop applying at the next load.
 * - The page's id, posted to the Frontend Registry's worker when that worker
 *   controls the page, so the calls it logs name the page they came from.
 *
 * Workers the page starts aren't wrapped: their WebSockets aren't seen.
 */

type Constructor = abstract new (...args: never[]) => unknown;

export function reportNetwork(post: Post, page: string): void {
  reportSockets(post);
  reportRegistrations(post);
  announcePage(page);
}

function reportSockets(post: Post): void {
  const Original = globalThis.WebSocket;
  if (typeof Original !== "function") return;
  let nextId = 1;
  const report = (socket: InspectedSocket) => post({ kind: "websocket", socket });
  globalThis.WebSocket = new Proxy(Original, {
    construct(target, args, newTarget) {
      // Constructing can throw, for an address the browser refuses; the page sees that as it would.
      const socket = Reflect.construct(target, args, newTarget) as WebSocket;
      try {
        const id = nextId++;
        const url = socket.url;
        let opened = false;
        const state = (next: SocketState) => report({ id, url, state: next });
        state("connecting");
        socket.addEventListener("open", () => {
          opened = true;
          state("open");
        });
        socket.addEventListener("close", () => state(opened ? "closed" : "failed"));
      } catch {
        // Reporting must never change the socket the page gets.
      }
      return socket;
    },
  });
}

function reportRegistrations(post: Post): void {
  const Container = (globalThis as { ServiceWorkerContainer?: Constructor & { prototype: ServiceWorkerContainer } }).ServiceWorkerContainer;
  const original = Container?.prototype.register;
  if (!Container || typeof original !== "function") return;
  Container.prototype.register = function register(this: ServiceWorkerContainer, ...args: Parameters<ServiceWorkerContainer["register"]>) {
    try {
      const [scriptURL, options] = args;
      const script = new URL(String(scriptURL), document.baseURI).href;
      // A scope is resolved against the page, and defaults to the script's directory.
      const scope = options?.scope === undefined ? new URL("./", script).href : new URL(String(options.scope), document.baseURI).href;
      post({ kind: "service-worker", registration: { script, scope } });
    } catch {
      // An address the browser will refuse is reported by its own error.
    }
    return original.apply(this, args);
  };
}

function announcePage(page: string): void {
  try {
    const controller = navigator.serviceWorker?.controller;
    if (controller && controller.scriptURL === new URL(ROUTING_WORKER_SCRIPT, window.location.origin).href) controller.postMessage({ type: MOCKS_CHANNEL, page } satisfies PageAnnouncement);
  } catch {
    // Without a controller to tell, the page's calls aren't logged under it.
  }
}
