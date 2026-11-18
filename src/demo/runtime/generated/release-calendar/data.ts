export type Approval = "approved" | "pending" | "blocked";

export interface Week {
  id: string;
  label: string;
  dates: string;
}

export interface ReleaseWindow {
  id: string;
  week: string;
  date: string;
  /** The date without its year, for the window's button. */
  day: string;
  time: string;
  /** The freezes that overlap the window. */
  freezes: readonly string[];
}

export interface Release {
  id: string;
  window: string;
  name: string;
  team: string;
  change: string;
  approval: Approval;
}

export interface Freeze {
  id: string;
  name: string;
  starts: string;
  ends: string;
  /** A full freeze stops every change; a partial one stops changes in its scope. */
  kind: "full" | "partial";
  scope: string;
}

export const TEAMS: readonly string[] = ["Cloud platform", "Digital channels", "Markets technology", "Payments", "Risk technology"];

export const WEEKS: readonly Week[] = [
  { id: "w43", label: "Week 43", dates: "19 to 23 Oct 2026" },
  { id: "w44", label: "Week 44", dates: "26 to 30 Oct 2026" },
  { id: "w45", label: "Week 45", dates: "2 to 6 Nov 2026" },
  { id: "w46", label: "Week 46", dates: "9 to 13 Nov 2026" },
];

export const FREEZES: readonly Freeze[] = [
  { id: "fz-payments-peak", name: "Payments peak freeze", starts: "26 Oct 2026, 06:00 ET", ends: "28 Oct 2026, 22:00 ET", kind: "partial", scope: "Payments and card systems, during month-end payroll runs." },
  { id: "fz-month-end", name: "Month-end close freeze", starts: "29 Oct 2026, 18:00 ET", ends: "2 Nov 2026, 06:00 ET", kind: "full", scope: "Every production system. Emergency changes need change board approval." },
  { id: "fz-us-midterms", name: "US midterm elections freeze", starts: "2 Nov 2026, 18:00 ET", ends: "4 Nov 2026, 18:00 ET", kind: "partial", scope: "Trading and market data platforms, through election night volatility." },
];

export const WINDOWS: readonly ReleaseWindow[] = [
  { id: "rw-1020", week: "w43", date: "Tue 20 Oct 2026", day: "Tue 20 Oct", time: "18:00 to 21:00 ET", freezes: [] },
  { id: "rw-1022", week: "w43", date: "Thu 22 Oct 2026", day: "Thu 22 Oct", time: "18:00 to 21:00 ET", freezes: [] },
  { id: "rw-1027", week: "w44", date: "Tue 27 Oct 2026", day: "Tue 27 Oct", time: "18:00 to 21:00 ET", freezes: ["fz-payments-peak"] },
  { id: "rw-1029", week: "w44", date: "Thu 29 Oct 2026", day: "Thu 29 Oct", time: "18:00 to 21:00 ET", freezes: ["fz-month-end"] },
  { id: "rw-1103", week: "w45", date: "Tue 3 Nov 2026", day: "Tue 3 Nov", time: "18:00 to 21:00 ET", freezes: ["fz-us-midterms"] },
  { id: "rw-1105", week: "w45", date: "Thu 5 Nov 2026", day: "Thu 5 Nov", time: "18:00 to 21:00 ET", freezes: [] },
  { id: "rw-1110", week: "w46", date: "Tue 10 Nov 2026", day: "Tue 10 Nov", time: "18:00 to 21:00 ET", freezes: [] },
  { id: "rw-1112", week: "w46", date: "Thu 12 Nov 2026", day: "Thu 12 Nov", time: "18:00 to 21:00 ET", freezes: [] },
];

export const RELEASES: readonly Release[] = [
  { id: "rel-4412", window: "rw-1020", name: "Payments API 4.12", team: "Payments", change: "CHG-20418", approval: "approved" },
  { id: "rel-4415", window: "rw-1020", name: "Mobile banking app 8.3", team: "Digital channels", change: "CHG-20422", approval: "approved" },
  { id: "rel-4419", window: "rw-1020", name: "Risk engine 2.7", team: "Risk technology", change: "CHG-20431", approval: "pending" },
  { id: "rel-4421", window: "rw-1022", name: "Client portal 5.1", team: "Digital channels", change: "CHG-20436", approval: "approved" },
  { id: "rel-4424", window: "rw-1022", name: "Kafka cluster upgrade", team: "Cloud platform", change: "CHG-20440", approval: "pending" },
  { id: "rel-4430", window: "rw-1027", name: "Ledger service 3.4", team: "Payments", change: "CHG-20452", approval: "blocked" },
  { id: "rel-4433", window: "rw-1027", name: "Market data feed 1.9", team: "Markets technology", change: "CHG-20457", approval: "approved" },
  { id: "rel-4441", window: "rw-1103", name: "Order router 6.2", team: "Markets technology", change: "CHG-20471", approval: "blocked" },
  { id: "rel-4443", window: "rw-1103", name: "Identity service 2.0", team: "Cloud platform", change: "CHG-20474", approval: "approved" },
  { id: "rel-4450", window: "rw-1105", name: "Payments API 4.13", team: "Payments", change: "CHG-20488", approval: "pending" },
  { id: "rel-4452", window: "rw-1105", name: "Mobile banking app 8.4", team: "Digital channels", change: "CHG-20491", approval: "pending" },
  { id: "rel-4460", window: "rw-1110", name: "Risk engine 2.8", team: "Risk technology", change: "CHG-20503", approval: "pending" },
  { id: "rel-4466", window: "rw-1112", name: "Client portal 5.2", team: "Digital channels", change: "CHG-20512", approval: "pending" },
  { id: "rel-4468", window: "rw-1112", name: "Log retention policy", team: "Cloud platform", change: "CHG-20515", approval: "pending" },
];
