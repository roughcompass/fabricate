export interface FxPair {
  id: string;
  pair: string;
  name: string;
  bid: number;
  ask: number;
  /** Change since the New York open, in pips. */
  change: number;
  low: number;
  high: number;
  /** How many decimals the pair quotes to. */
  decimals: number;
  /** One pip, in the quote currency. */
  pip: number;
}

export const UPDATED = "14:30:05 ET";

export const PAIRS: readonly FxPair[] = [
  { id: "eurusd", pair: "EUR/USD", name: "Euro / US dollar", bid: 1.08412, ask: 1.08419, change: 23, low: 1.08105, high: 1.08533, decimals: 5, pip: 0.0001 },
  { id: "gbpusd", pair: "GBP/USD", name: "British pound / US dollar", bid: 1.27154, ask: 1.27166, change: -41, low: 1.27011, high: 1.27688, decimals: 5, pip: 0.0001 },
  { id: "usdjpy", pair: "USD/JPY", name: "US dollar / Japanese yen", bid: 151.284, ask: 151.296, change: 57, low: 150.612, high: 151.402, decimals: 3, pip: 0.01 },
  { id: "usdchf", pair: "USD/CHF", name: "US dollar / Swiss franc", bid: 0.90237, ask: 0.90251, change: -8, low: 0.90102, high: 0.90466, decimals: 5, pip: 0.0001 },
  { id: "audusd", pair: "AUD/USD", name: "Australian dollar / US dollar", bid: 0.65981, ask: 0.65992, change: 12, low: 0.65744, high: 0.66105, decimals: 5, pip: 0.0001 },
  { id: "usdcad", pair: "USD/CAD", name: "US dollar / Canadian dollar", bid: 1.36712, ask: 1.36727, change: -19, low: 1.36521, high: 1.37042, decimals: 5, pip: 0.0001 },
  { id: "eurgbp", pair: "EUR/GBP", name: "Euro / British pound", bid: 0.85258, ask: 0.85271, change: 31, low: 0.85016, high: 0.85309, decimals: 5, pip: 0.0001 },
  { id: "usdsgd", pair: "USD/SGD", name: "US dollar / Singapore dollar", bid: 1.34466, ask: 1.34492, change: 0, low: 1.34311, high: 1.34655, decimals: 5, pip: 0.0001 },
];

/** The last quotes for each pair, newest first. */
export const QUOTES: Readonly<Record<string, readonly { time: string; bid: number; ask: number }[]>> = {
  eurusd: [
    { time: "14:30:05", bid: 1.08412, ask: 1.08419 },
    { time: "14:29:41", bid: 1.08409, ask: 1.08417 },
    { time: "14:29:12", bid: 1.08398, ask: 1.08406 },
    { time: "14:28:50", bid: 1.08401, ask: 1.08409 },
  ],
  gbpusd: [
    { time: "14:30:02", bid: 1.27154, ask: 1.27166 },
    { time: "14:29:37", bid: 1.27161, ask: 1.27173 },
    { time: "14:29:05", bid: 1.27172, ask: 1.27185 },
    { time: "14:28:44", bid: 1.27168, ask: 1.27180 },
  ],
  usdjpy: [
    { time: "14:30:04", bid: 151.284, ask: 151.296 },
    { time: "14:29:40", bid: 151.279, ask: 151.291 },
    { time: "14:29:18", bid: 151.266, ask: 151.278 },
    { time: "14:28:51", bid: 151.271, ask: 151.283 },
  ],
  usdchf: [
    { time: "14:30:01", bid: 0.90237, ask: 0.90251 },
    { time: "14:29:33", bid: 0.90241, ask: 0.90255 },
    { time: "14:29:09", bid: 0.90249, ask: 0.90263 },
    { time: "14:28:47", bid: 0.90244, ask: 0.90258 },
  ],
  audusd: [
    { time: "14:30:03", bid: 0.65981, ask: 0.65992 },
    { time: "14:29:39", bid: 0.65977, ask: 0.65988 },
    { time: "14:29:14", bid: 0.65969, ask: 0.6598 },
    { time: "14:28:49", bid: 0.65972, ask: 0.65983 },
  ],
  usdcad: [
    { time: "14:30:00", bid: 1.36712, ask: 1.36727 },
    { time: "14:29:35", bid: 1.36719, ask: 1.36734 },
    { time: "14:29:11", bid: 1.36726, ask: 1.36741 },
    { time: "14:28:46", bid: 1.36722, ask: 1.36737 },
  ],
  eurgbp: [
    { time: "14:30:05", bid: 0.85258, ask: 0.85271 },
    { time: "14:29:42", bid: 0.85254, ask: 0.85267 },
    { time: "14:29:16", bid: 0.85247, ask: 0.8526 },
    { time: "14:28:52", bid: 0.8525, ask: 0.85263 },
  ],
  usdsgd: [
    { time: "14:29:58", bid: 1.34466, ask: 1.34492 },
    { time: "14:29:30", bid: 1.34466, ask: 1.34492 },
    { time: "14:29:02", bid: 1.34463, ask: 1.34489 },
    { time: "14:28:40", bid: 1.34468, ask: 1.34494 },
  ],
};
