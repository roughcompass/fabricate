// The orders API. `.test` never resolves, so without a mock set every call
// fails, and each part of the page shows its own unavailable state.
export const API = "https://api.orders.test/v1";
const TICKER = "wss://api.orders.test/v1/ticker";

/** The answer's JSON, or an error for a status of 400 or more. */
async function json(response) {
  if (!response.ok) throw new Error(`The orders API answered ${response.status}`);
  return response.json();
}

/**
 * The five most recent orders, through XMLHttpRequest, as the portal's older
 * code asks for them. `_` keeps a browser cache from answering.
 */
export function loadRecentOrders() {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("GET", `${API}/orders?limit=5&_=${Date.now()}`);
    request.responseType = "json";
    request.onload = () => (request.status < 400 && request.response ? resolve(request.response) : reject(new Error(`The orders API answered ${request.status}`)));
    request.onerror = () => reject(new Error("The orders API couldn't be reached"));
    request.send();
  });
}

/** The five most recent orders again, through fetch, for Refresh, which skips the browser's cache its own way. */
export function refreshRecentOrders() {
  return fetch(`${API}/orders?limit=5`, { cache: "no-store" }).then(json);
}

/** One account with its orders. */
export function loadAccount(id) {
  return fetch(`${API}/accounts/${encodeURIComponent(id)}`).then(json);
}

/** The orders in +status+, open or closed. */
export function searchOrders(status) {
  return fetch(`${API}/orders/search`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) }).then(json);
}

/** Starts an export of every order. */
export function startExport() {
  return fetch(`${API}/exports`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ format: "pdf" }) }).then(json);
}

/** An export's progress: pending, then ready. */
export function exportStatus(id) {
  return fetch(`${API}/exports/${encodeURIComponent(id)}`).then(json);
}

/** Orders as they're placed, as an event stream. */
export function liveOrders() {
  return new EventSource(`${API}/orders/stream`);
}

/** Quotes as they change, over a WebSocket. */
export function ticker() {
  return new WebSocket(TICKER);
}
