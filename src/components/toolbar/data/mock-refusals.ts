import type { WorkerRefusal } from "../routing/view-worker";

/*
 * What Data and preview mode say when a mock set can't apply
 * (add-mock-sets, design decision 3; template-demo/mock-data spec, "Data
 * says where a mock set can't apply"). Mock sets apply through the same
 * service worker as version routing, so they're refused where routing is:
 * outside a secure context, without service workers, and beside the build's
 * own service worker for its path. Every statement is a draft until DE
 * design and PMs approve it.
 */

/** Why the view's mock set can't apply, for a refusal of the view's worker or a worker that couldn't start. */
export function mockRefusalText(refusal: WorkerRefusal | "failed"): string {
  switch (refusal) {
    case "insecure":
      return "Mock sets need HTTPS. Browsers allow the service worker they use only on pages served over HTTPS or from localhost.";
    case "unsupported":
      return "This browser doesn't allow service workers here, so mock sets can't apply.";
    case "foreign":
      return "Mock sets can't apply beside the application's own service worker for its build's path.";
    case "failed":
      return "The Frontend Registry's service worker couldn't start in this browser, so the mock set isn't applied.";
  }
}

/** Said with every refusal: the build's screenshots don't depend on the browser. */
export const SCREENSHOTS_STILL_APPLY = "Screenshots of the build still apply its default mock set.";

/** Said when the build registered its own service worker while a set applied. */
export const REGISTERED_WHILE_VIEWING = "The application registered its own service worker, so mock sets stop applying at the next load.";

/** Said beside the WebSocket connections the page opened. */
export const WEBSOCKETS_NOT_MOCKED = "WebSockets aren't mocked yet.";
