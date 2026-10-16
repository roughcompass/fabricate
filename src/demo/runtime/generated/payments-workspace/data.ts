export interface Payee {
  id: string;
  name: string;
  bank: string;
  account: string;
  lastPaid: string;
  favorite: boolean;
}

export const PAYEES: readonly Payee[] = [
  { id: "northwind", name: "Northwind Supplies", bank: "Harbor Trust", account: "4821", lastPaid: "Sep 24", favorite: true },
  { id: "bluebird", name: "Bluebird Logistics", bank: "First Meridian", account: "1077", lastPaid: "Sep 22", favorite: false },
  { id: "cobalt", name: "Cobalt Office Co.", bank: "Pioneer Savings", account: "3390", lastPaid: "Sep 19", favorite: true },
  { id: "evergreen", name: "Evergreen Facilities", bank: "Harbor Trust", account: "5512", lastPaid: "Sep 12", favorite: false },
  { id: "lumen", name: "Lumen Energy", bank: "Atlas National", account: "8846", lastPaid: "Sep 03", favorite: false },
  { id: "quarry", name: "Quarry Street Legal", bank: "First Meridian", account: "2208", lastPaid: "Aug 28", favorite: false },
];

export const ACTIVITY = [
  { id: "PMT-3301", payee: "Northwind Supplies", amount: "12,400.00", status: "Settled" },
  { id: "PMT-3302", payee: "Lumen Energy", amount: "3,180.25", status: "Pending approval" },
  { id: "PMT-3303", payee: "Bluebird Logistics", amount: "8,950.00", status: "Pending approval" },
  { id: "PMT-3304", payee: "Cobalt Office Co.", amount: "642.10", status: "Settled" },
  { id: "PMT-3305", payee: "Quarry Street Legal", amount: "5,000.00", status: "Failed" },
] as const;
