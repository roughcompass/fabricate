/**
 * The running application's event bus (portal-runtime spec): topic-based
 * publish and subscribe among microfrontends, with every message recorded for
 * the toolbar. No React or browser dependencies, so it can be tested directly.
 */

export interface BusMessage {
  readonly id: number;
  readonly topic: string;
  readonly payload: unknown;
  /** A member ID, or "toolbar" for messages published from the toolbar. */
  readonly publisher: string;
  /** The members that received the message. */
  readonly receivers: readonly string[];
  /** Milliseconds since the bus was created. */
  readonly time: number;
}

type Handler = (payload: unknown, message: BusMessage) => void;

export interface Bus {
  subscribe(topic: string, subscriber: string, handler: Handler): () => void;
  publish(topic: string, payload: unknown, publisher: string): BusMessage;
  messages(): readonly BusMessage[];
  /** Notifies a listener after every message; returns an unsubscribe function. */
  onMessage(listener: (message: BusMessage) => void): () => void;
  /** Topics with at least one subscriber. */
  topics(): string[];
}

export const MESSAGE_LIMIT = 200;

export function createBus(clock: () => number = () => Date.now()): Bus {
  const started = clock();
  const subscribers = new Map<string, Map<string, Handler>>();
  const listeners = new Set<(message: BusMessage) => void>();
  let log: BusMessage[] = [];
  let next = 1;

  return {
    subscribe(topic, subscriber, handler) {
      const forTopic = subscribers.get(topic) ?? new Map<string, Handler>();
      forTopic.set(subscriber, handler);
      subscribers.set(topic, forTopic);
      return () => {
        if (subscribers.get(topic)?.get(subscriber) === handler) subscribers.get(topic)!.delete(subscriber);
      };
    },
    publish(topic, payload, publisher) {
      const targets = [...(subscribers.get(topic) ?? new Map<string, Handler>()).entries()].filter(([subscriber]) => subscriber !== publisher);
      const message: BusMessage = { id: next++, topic, payload, publisher, receivers: targets.map(([subscriber]) => subscriber), time: clock() - started };
      log = [...log, message].slice(-MESSAGE_LIMIT);
      for (const [, handler] of targets) handler(payload, message);
      for (const listener of listeners) listener(message);
      return message;
    },
    messages() {
      return log;
    },
    onMessage(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    topics() {
      return [...subscribers.entries()].filter(([, forTopic]) => forTopic.size > 0).map(([topic]) => topic).sort();
    },
  };
}
