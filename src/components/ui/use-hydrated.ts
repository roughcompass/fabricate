import { useSyncExternalStore } from "react";

/** A store with nothing to subscribe to: its value differs only between the server render and the browser. */
export const subscribeNever = () => () => {};

/**
 * True once the component runs in the browser after hydration; false in the
 * server render and the first client render, so the two match. A control
 * that works without JavaScript renders its fallback until this is true.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(subscribeNever, () => true, () => false);
}
