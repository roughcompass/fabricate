export type LimitStatus = "within" | "warning" | "breach";

export interface Desk {
  id: string;
  name: string;
  /** The risk measure the limit is set on. */
  measure: string;
  head: string;
  /** Limit and usage, in USD thousands. */
  limit: number;
  usage: number;
}

export interface LimitEvent {
  id: string;
  status: Exclude<LimitStatus, "within">;
  date: string;
  time: string;
  /** Usage when the event fired, as a percentage of the limit. */
  usage: number;
  note: string;
}

export const UPDATED = "14:30 ET";

/** A desk is at warning from 85% of its limit, and in breach above 100%. */
export const WARNING_AT = 85;

export const DESKS: readonly Desk[] = [
  { id: "fx-options", name: "FX options", measure: "Vega", head: "Rachel Kim", limit: 850, usage: 912 },
  { id: "g10-rates", name: "G10 rates", measure: "VaR (99%, 1 day)", head: "Oliver Grant", limit: 4500, usage: 3105 },
  { id: "em-rates", name: "EM rates", measure: "VaR (99%, 1 day)", head: "Tomás Alvarez", limit: 2000, usage: 1842 },
  { id: "fx-spot", name: "FX spot", measure: "VaR (99%, 1 day)", head: "Rachel Kim", limit: 3000, usage: 2130 },
  { id: "ig-credit", name: "IG credit", measure: "CS01", head: "Priya Raman", limit: 1200, usage: 702 },
  { id: "hy-credit", name: "HY credit", measure: "CS01", head: "Priya Raman", limit: 600, usage: 648 },
  { id: "equity-derivatives", name: "Equity derivatives", measure: "Delta", head: "Marcus Lee", limit: 5000, usage: 4410 },
  { id: "commodities", name: "Commodities", measure: "VaR (99%, 1 day)", head: "Ingrid Halvorsen", limit: 1500, usage: 615 },
];

/** Breaches and warnings in the last 30 days, newest first. */
export const EVENTS: Readonly<Record<string, readonly LimitEvent[]>> = {
  "fx-options": [
    { id: "evt-2291", status: "breach", date: "16 Oct 2026", time: "09:42 ET", usage: 107, note: "Vega over limit after a EUR/USD 3-month option block." },
    { id: "evt-2274", status: "warning", date: "15 Oct 2026", time: "16:10 ET", usage: 91, note: "USD/JPY volatility rose ahead of the policy meeting." },
  ],
  "g10-rates": [{ id: "evt-2203", status: "warning", date: "8 Oct 2026", time: "15:20 ET", usage: 87, note: "Curve steepener added before the payrolls release. Cleared the same day." }],
  "em-rates": [{ id: "evt-2288", status: "warning", date: "16 Oct 2026", time: "13:05 ET", usage: 92, note: "Receiver position in BRL swaps." }],
  "hy-credit": [
    { id: "evt-2289", status: "breach", date: "16 Oct 2026", time: "11:15 ET", usage: 108, note: "New issue allocation in telecom bonds." },
    { id: "evt-2240", status: "warning", date: "14 Oct 2026", time: "10:02 ET", usage: 92, note: "Index hedge rolled a day late." },
  ],
  "equity-derivatives": [
    { id: "evt-2285", status: "warning", date: "16 Oct 2026", time: "10:30 ET", usage: 88, note: "Delta from single-stock call overwriting." },
    { id: "evt-2177", status: "warning", date: "2 Oct 2026", time: "14:48 ET", usage: 86, note: "Index rebalance flows. Cleared the next morning." },
  ],
};
