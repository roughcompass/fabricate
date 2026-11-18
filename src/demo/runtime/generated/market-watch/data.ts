export interface Instrument {
  symbol: string;
  name: string;
  /** The last trade, in US dollars. */
  price: number;
  /** Change since the previous close, in percent. */
  change: number;
}

/** When the watchlist's prices were last updated. */
export const UPDATED = "14:30:05 ET";

/** The trading session the chart covers so far, with times in ET. */
export const SESSION = { date: "16 Oct 2026", open: "09:30", latest: "14:30" } as const;

export const INSTRUMENTS: readonly Instrument[] = [
  { symbol: "ACME", name: "Acme Corp", price: 182.4, change: 1.84 },
  { symbol: "GLBX", name: "Globex Holdings", price: 64.12, change: -0.92 },
  { symbol: "INIT", name: "Initech Systems", price: 41.07, change: 0.35 },
  { symbol: "UMBR", name: "Umbrella Health", price: 219.55, change: -2.11 },
  { symbol: "STRK", name: "Stark Industrial", price: 97.3, change: 3.02 },
  { symbol: "WAYN", name: "Wayne Logistics", price: 128.66, change: 0.08 },
];

export interface Trade {
  id: string;
  /** Execution time, Eastern. */
  time: string;
  symbol: string;
  side: "Buy" | "Sell";
  quantity: number;
  /** Execution price, in US dollars. */
  price: number;
  status: "Filled" | "Awaiting allocation";
}

export const TRADES: readonly Trade[] = [
  { id: "T-8812", time: "09:41 ET", symbol: "ACME", side: "Buy", quantity: 1200, price: 181.95, status: "Filled" },
  { id: "T-8813", time: "10:07 ET", symbol: "UMBR", side: "Sell", quantity: 400, price: 220.1, status: "Awaiting allocation" },
  { id: "T-8814", time: "11:22 ET", symbol: "STRK", side: "Buy", quantity: 2500, price: 96.8, status: "Awaiting allocation" },
  { id: "T-8815", time: "13:58 ET", symbol: "GLBX", side: "Sell", quantity: 900, price: 64.4, status: "Filled" },
];

/** The desk's gross exposure in US dollars, as last calculated and after a recalculation. */
export const EXPOSURE = { calculated: 1_418_250, recalculated: 1_426_940, at: "14:30 ET", recalculatedAt: "14:31 ET" } as const;
