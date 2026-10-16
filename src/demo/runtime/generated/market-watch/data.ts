export interface Instrument {
  symbol: string;
  name: string;
  price: number;
  change: number;
}

export const INSTRUMENTS: readonly Instrument[] = [
  { symbol: "ACME", name: "Acme Corp", price: 182.4, change: 1.84 },
  { symbol: "GLBX", name: "Globex Holdings", price: 64.12, change: -0.92 },
  { symbol: "INIT", name: "Initech Systems", price: 41.07, change: 0.35 },
  { symbol: "UMBR", name: "Umbrella Health", price: 219.55, change: -2.11 },
  { symbol: "STRK", name: "Stark Industrial", price: 97.3, change: 3.02 },
  { symbol: "WAYN", name: "Wayne Logistics", price: 128.66, change: 0.08 },
];

export const TRADES = [
  { id: "T-8812", symbol: "ACME", side: "Buy", quantity: "1,200", price: "181.95", status: "Filled" },
  { id: "T-8813", symbol: "UMBR", side: "Sell", quantity: "400", price: "220.10", status: "Awaiting allocation" },
  { id: "T-8814", symbol: "STRK", side: "Buy", quantity: "2,500", price: "96.80", status: "Awaiting allocation" },
  { id: "T-8815", symbol: "GLBX", side: "Sell", quantity: "900", price: "64.40", status: "Filled" },
] as const;
