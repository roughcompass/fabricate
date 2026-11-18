export interface Payee {
  id: string;
  name: string;
  bank: string;
  /** The last four digits of the payee's account, shown masked. */
  account: string;
  lastPaid: string;
  favorite: boolean;
}

export const PAYEES: readonly Payee[] = [
  { id: "northwind", name: "Northwind Supplies", bank: "Harbor Trust", account: "4821", lastPaid: "14 Oct 2026", favorite: true },
  { id: "bluebird", name: "Bluebird Logistics", bank: "First Meridian", account: "1077", lastPaid: "12 Oct 2026", favorite: false },
  { id: "cobalt", name: "Cobalt Office Co.", bank: "Pioneer Savings", account: "3390", lastPaid: "9 Oct 2026", favorite: true },
  { id: "evergreen", name: "Evergreen Facilities", bank: "Harbor Trust", account: "5512", lastPaid: "2 Oct 2026", favorite: false },
  { id: "lumen", name: "Lumen Energy", bank: "Atlas National", account: "8846", lastPaid: "25 Sep 2026", favorite: false },
  { id: "quarry", name: "Quarry Street Legal", bank: "First Meridian", account: "2208", lastPaid: "18 Sep 2026", favorite: false },
];

/** The accounts a transfer can be sent from. */
export const FROM_ACCOUNTS = [
  { value: "operating", label: "Operating ••••2290" },
  { value: "payroll", label: "Payroll ••••7731" },
] as const;

export type PaymentStatus = "Settled" | "Pending approval" | "Failed";

export interface Payment {
  id: string;
  payee: string;
  /** In US dollars. */
  amount: number;
  /** When the payment was submitted today. */
  time: string;
  status: PaymentStatus;
}

export const ACTIVITY: readonly Payment[] = [
  { id: "PMT-3301", payee: "Northwind Supplies", amount: 12400, time: "08:42 ET", status: "Settled" },
  { id: "PMT-3302", payee: "Lumen Energy", amount: 3180.25, time: "09:15 ET", status: "Pending approval" },
  { id: "PMT-3303", payee: "Bluebird Logistics", amount: 8950, time: "10:03 ET", status: "Pending approval" },
  { id: "PMT-3304", payee: "Cobalt Office Co.", amount: 642.1, time: "11:27 ET", status: "Settled" },
  { id: "PMT-3305", payee: "Quarry Street Legal", amount: 5000, time: "12:50 ET", status: "Failed" },
];

/** Formats an amount to two decimals, such as "12,400.00". */
export const money = (amount: number) => amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Formats US dollars with the ISO code, such as "USD 12,400.00". */
export const usd = (amount: number) => `USD ${money(amount)}`;
