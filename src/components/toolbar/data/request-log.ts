import type { InspectedSocket } from "../inspector/protocol";
import type { CallOutcome, LoggedCall } from "../routing/mock-log";
import { WEBSOCKETS_NOT_MOCKED } from "./mock-refusals";

/*
 * Data's request list (add-mock-sets, design decision 15; template-demo/
 * mock-data spec, "Data lists the page's API calls and what answered them"):
 * the frame's API calls since its document loaded, as the view's worker
 * logged them, and the WebSocket connections the frame agent saw, newest
 * first, each with one outcome in words.
 */

/** How many calls the list keeps for a page. */
export const REQUEST_LIMIT = 500;

export const OUTCOMES: readonly CallOutcome[] = ["mocked", "passed", "not-matched", "failed"];

/** Each outcome's name, as the filters say it. */
export const OUTCOME_LABELS: Readonly<Record<CallOutcome, string>> = { mocked: "Mocked", passed: "Passed through", "not-matched": "Not matched", failed: "Failed" };

/** A row of the list: an API call the worker handled, or a WebSocket connection. */
export interface RequestRow {
  readonly id: string;
  readonly method: string;
  readonly url: string;
  readonly outcome: CallOutcome;
  /** The outcome in words, such as "Mocked by rule GET /v1/orders" or "Failed, couldn't connect or was blocked by CORS". */
  readonly summary: string;
  /** The status, or what happened instead. */
  readonly status: string;
  /** How long the answer took, in milliseconds; null for a WebSocket. */
  readonly durationMs: number | null;
  readonly at: number;
  /** The call as the worker logged it; null for a WebSocket. */
  readonly call: LoggedCall | null;
}

/** +text+ with its first letter lowercased, to follow a comma. */
const lowered = (text: string) => `${text[0]!.toLowerCase()}${text.slice(1)}`;

/** A logged call as a row. */
export function callRow(call: LoggedCall): RequestRow {
  const failure = call.error ?? (call.status !== null ? String(call.status) : "no answer");
  const summary =
    call.outcome === "mocked" && call.rule
      ? `Mocked by rule ${call.rule.label}`
      : call.outcome === "failed"
        ? `Failed, ${call.error ? lowered(call.error) : (call.status ?? "no answer")}`
        : OUTCOME_LABELS[call.outcome];
  return { id: call.id, method: call.method, url: call.url, outcome: call.outcome, summary, status: call.outcome === "failed" ? failure : call.status === null ? "Opaque" : String(call.status), durationMs: call.durationMs, at: call.at, call };
}

/** A WebSocket connection as a row: it goes to its own address, so it passed through while it opened, and failed when it never did. */
export function socketRow(socket: InspectedSocket, at: number): RequestRow {
  const failed = socket.state === "failed";
  const status = { connecting: "Connecting", open: "Open", closed: "Closed", failed: "Never opened" }[socket.state];
  return { id: `ws-${socket.id}`, method: "WebSocket", url: socket.url, outcome: failed ? "failed" : "passed", summary: failed ? `Failed. ${WEBSOCKETS_NOT_MOCKED}` : `Passed through. ${WEBSOCKETS_NOT_MOCKED}`, status, durationMs: null, at, call: null };
}

/** +rows+ with +row+ added, or put in place of the row with its id, newest first, up to the limit. */
export function addRow(rows: readonly RequestRow[], row: RequestRow): readonly RequestRow[] {
  const index = rows.findIndex((each) => each.id === row.id);
  if (index !== -1) return rows.with(index, { ...row, at: rows[index]!.at });
  return [row, ...rows].slice(0, REQUEST_LIMIT);
}

/** How many rows have each outcome. */
export function outcomeCounts(rows: readonly RequestRow[]): Record<CallOutcome, number> {
  const counts: Record<CallOutcome, number> = { mocked: 0, passed: 0, "not-matched": 0, failed: 0 };
  for (const row of rows) counts[row.outcome]++;
  return counts;
}

/** Whether a rule can be made from +row+: a call no rule answered, that wasn't matched or that failed. */
export function canCreateRule(row: RequestRow): boolean {
  return row.call !== null && row.call.rule === null && (row.outcome === "not-matched" || row.outcome === "failed");
}
