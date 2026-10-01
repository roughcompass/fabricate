/**
 * PLANTED HOT SPOT. Blocks the main thread on purpose, so the toolbar's timing
 * tool always has a poor interaction to find (portal-runtime spec: a slow
 * microfrontend creates a hot spot). Do not optimize or remove it; the catalog
 * test fails if a hero loses its slow member.
 */
export function blockMainThread(ms: number): void {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    // Busy-wait: the point is to occupy the main thread.
  }
}
