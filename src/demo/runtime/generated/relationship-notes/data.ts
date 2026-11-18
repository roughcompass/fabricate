export interface Relationship {
  id: string;
  client: string;
  sector: string;
  banker: string;
  lastMeeting: string;
  /** How many days ago the last meeting was, as of today. */
  daysSince: number;
  followUp: { action: string; due: string; status: "Overdue" | "Due this week" | "Scheduled" };
}

export interface Note {
  id: string;
  date: string;
  author: string;
  text: string;
}

export interface FollowUp {
  id: string;
  action: string;
  owner: string;
  due: string;
  done: boolean;
}

export const TODAY = "17 Nov 2026";

export const RELATIONSHIPS: readonly Relationship[] = [
  { id: "northwind", client: "Northwind Logistics Inc.", sector: "Transport and logistics", banker: "Hannah Okafor", lastMeeting: "12 Nov 2026", daysSince: 5, followUp: { action: "Send revised revolver pricing", due: "19 Nov 2026", status: "Due this week" } },
  { id: "halvorsen", client: "Halvorsen Shipping AS", sector: "Shipping", banker: "Erik Lindqvist", lastMeeting: "28 Oct 2026", daysSince: 20, followUp: { action: "Share vessel valuation report", due: "10 Nov 2026", status: "Overdue" } },
  { id: "brightwater", client: "Brightwater Utilities", sector: "Utilities", banker: "Hannah Okafor", lastMeeting: "04 Nov 2026", daysSince: 13, followUp: { action: "Introduce the green bond team", due: "02 Dec 2026", status: "Scheduled" } },
  { id: "kestrel", client: "Kestrel Components GmbH", sector: "Industrials", banker: "Julia Becker", lastMeeting: "15 Oct 2026", daysSince: 33, followUp: { action: "Book a treasury review", due: "14 Nov 2026", status: "Overdue" } },
  { id: "sakura", client: "Sakura Precision KK", sector: "Technology hardware", banker: "Kenta Mori", lastMeeting: "09 Nov 2026", daysSince: 8, followUp: { action: "Confirm FX hedging workshop date", due: "20 Nov 2026", status: "Due this week" } },
  { id: "cobalt", client: "Cobalt Data Systems", sector: "Software", banker: "Marcus Bell", lastMeeting: "30 Sep 2026", daysSince: 48, followUp: { action: "Discuss bridge loan refinancing", due: "08 Dec 2026", status: "Scheduled" } },
  { id: "oakridge", client: "Oakridge Facilities Ltd", sector: "Real estate services", banker: "Julia Becker", lastMeeting: "06 Nov 2026", daysSince: 11, followUp: { action: "Send cash pooling proposal", due: "18 Nov 2026", status: "Due this week" } },
];

/** Meeting notes for each client, newest first. */
export const NOTES: Readonly<Record<string, readonly Note[]>> = {
  northwind: [
    { id: "n2", date: "12 Nov 2026", author: "Hannah Okafor", text: "CFO wants to extend the revolver by two years and lift it to USD 175m ahead of the Mexico expansion. Asked for indicative pricing this week." },
    { id: "n1", date: "21 Sep 2026", author: "Hannah Okafor", text: "Quarterly review. Leverage down to 2.85x; they're comfortable with current covenants." },
  ],
  halvorsen: [{ id: "n1", date: "28 Oct 2026", author: "Erik Lindqvist", text: "Two new vessels delivered in Q3. Treasurer asked for the latest valuation report to support the loan-to-value test." }],
  brightwater: [{ id: "n1", date: "04 Nov 2026", author: "Hannah Okafor", text: "Planning a first green bond in 2027. Interested in meeting our sustainable finance team." }],
  kestrel: [{ id: "n1", date: "15 Oct 2026", author: "Julia Becker", text: "Supply chain pressure easing. Open to reviewing their EUR cash management setup early next year." }],
  sakura: [{ id: "n1", date: "09 Nov 2026", author: "Kenta Mori", text: "USD receivables growing quickly. Treasury team asked for an FX hedging workshop before year end." }],
  cobalt: [],
  oakridge: [{ id: "n1", date: "06 Nov 2026", author: "Julia Becker", text: "Running cash across nine entities. Keen to see a notional pooling proposal." }],
};

/** Open and closed follow-ups for each client. */
export const FOLLOW_UPS: Readonly<Record<string, readonly FollowUp[]>> = {
  northwind: [
    { id: "f1", action: "Send revised revolver pricing", owner: "Hannah Okafor", due: "19 Nov 2026", done: false },
    { id: "f2", action: "Ask credit for an increased limit", owner: "Hannah Okafor", due: "15 Nov 2026", done: true },
  ],
  halvorsen: [{ id: "f1", action: "Share vessel valuation report", owner: "Erik Lindqvist", due: "10 Nov 2026", done: false }],
  brightwater: [{ id: "f1", action: "Introduce the green bond team", owner: "Hannah Okafor", due: "02 Dec 2026", done: false }],
  kestrel: [{ id: "f1", action: "Book a treasury review", owner: "Julia Becker", due: "14 Nov 2026", done: false }],
  sakura: [{ id: "f1", action: "Confirm FX hedging workshop date", owner: "Kenta Mori", due: "20 Nov 2026", done: false }],
  cobalt: [{ id: "f1", action: "Discuss bridge loan refinancing", owner: "Marcus Bell", due: "08 Dec 2026", done: false }],
  oakridge: [{ id: "f1", action: "Send cash pooling proposal", owner: "Julia Becker", due: "18 Nov 2026", done: false }],
};
