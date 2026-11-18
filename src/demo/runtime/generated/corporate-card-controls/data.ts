export type CardStatus = "Active" | "Frozen" | "Change pending";

export interface CorporateCard {
  id: string;
  holder: string;
  department: string;
  /** The card number's last four digits; the rest stays masked. */
  last4: string;
  currency: string;
  /** Monthly spend limit. */
  limit: number;
  /** Spent since the 1st of this month. */
  spent: number;
  /** Largest single purchase the card allows. */
  perPurchase: number;
  status: CardStatus;
}

export interface MerchantRule {
  id: string;
  label: string;
  allowed: boolean;
}

export interface TrailEntry {
  id: string;
  date: string;
  actor: string;
  change: string;
  outcome: "Approved" | "Rejected" | "Pending approval";
}

export const AS_OF = "17 Nov 2026";

export const CARDS: readonly CorporateCard[] = [
  { id: "4821", holder: "Amelia Grant", department: "Treasury", last4: "4821", currency: "USD", limit: 25000, spent: 15480.4, perPurchase: 5000, status: "Active" },
  { id: "1937", holder: "Rafael Ortiz", department: "Sales, Americas", last4: "1937", currency: "USD", limit: 15000, spent: 13920.75, perPurchase: 2500, status: "Active" },
  { id: "6604", holder: "Sophie Laurent", department: "Sales, EMEA", last4: "6604", currency: "EUR", limit: 12000, spent: 4210.0, perPurchase: 2000, status: "Change pending" },
  { id: "2290", holder: "Kenji Watanabe", department: "Procurement", last4: "2290", currency: "USD", limit: 50000, spent: 21875.2, perPurchase: 10000, status: "Active" },
  { id: "7315", holder: "Grace Mensah", department: "Facilities", last4: "7315", currency: "GBP", limit: 8000, spent: 7990.0, perPurchase: 1500, status: "Frozen" },
  { id: "3058", holder: "Daniel Novak", department: "Technology", last4: "3058", currency: "USD", limit: 20000, spent: 3120.6, perPurchase: 5000, status: "Active" },
  { id: "8842", holder: "Priya Raman", department: "Marketing", last4: "8842", currency: "USD", limit: 10000, spent: 6455.3, perPurchase: 2500, status: "Active" },
  { id: "5176", holder: "Oliver Brandt", department: "Legal", last4: "5176", currency: "EUR", limit: 6000, spent: 0, perPurchase: 1000, status: "Active" },
];

const rules = (travel: boolean, online: boolean, cash: boolean, international: boolean, gambling = false): MerchantRule[] => [
  { id: "travel", label: "Travel and lodging", allowed: travel },
  { id: "online", label: "Online purchases", allowed: online },
  { id: "cash", label: "Cash withdrawals", allowed: cash },
  { id: "international", label: "International merchants", allowed: international },
  { id: "gambling", label: "Gambling and betting", allowed: gambling },
];

/** Merchant rules for each card. */
export const RULES: Readonly<Record<string, readonly MerchantRule[]>> = {
  "4821": rules(true, true, false, true),
  "1937": rules(true, true, true, true),
  "6604": rules(true, true, false, true),
  "2290": rules(false, true, false, true),
  "7315": rules(false, false, false, false),
  "3058": rules(true, true, false, false),
  "8842": rules(true, true, false, true),
  "5176": rules(true, false, false, true),
};

/** Each card's approval trail, newest first. */
export const TRAIL: Readonly<Record<string, readonly TrailEntry[]>> = {
  "4821": [
    { id: "t1", date: "02 Nov 2026", actor: "Marcus Bell", change: "Monthly limit raised to USD 25,000.00", outcome: "Approved" },
    { id: "t2", date: "14 Sep 2026", actor: "Marcus Bell", change: "International merchants allowed", outcome: "Approved" },
  ],
  "1937": [
    { id: "t1", date: "28 Oct 2026", actor: "Lena Fischer", change: "Cash withdrawals allowed for client travel", outcome: "Approved" },
    { id: "t2", date: "03 Oct 2026", actor: "Lena Fischer", change: "Monthly limit raised to USD 20,000.00", outcome: "Rejected" },
  ],
  "6604": [
    { id: "t1", date: "15 Nov 2026", actor: "Sophie Laurent", change: "Monthly limit raised to EUR 15,000.00", outcome: "Pending approval" },
    { id: "t2", date: "21 Aug 2026", actor: "Henrik Dahl", change: "Card issued with EUR 12,000.00 monthly limit", outcome: "Approved" },
  ],
  "2290": [
    { id: "t1", date: "09 Oct 2026", actor: "Marcus Bell", change: "Travel and lodging blocked", outcome: "Approved" },
  ],
  "7315": [
    { id: "t1", date: "12 Nov 2026", actor: "Card fraud team", change: "Card frozen after an unrecognized purchase", outcome: "Approved" },
    { id: "t2", date: "30 Jun 2026", actor: "Lena Fischer", change: "Per-purchase limit lowered to GBP 1,500.00", outcome: "Approved" },
  ],
  "3058": [
    { id: "t1", date: "19 Sep 2026", actor: "Marcus Bell", change: "International merchants blocked", outcome: "Approved" },
  ],
  "8842": [
    { id: "t1", date: "06 Nov 2026", actor: "Lena Fischer", change: "Per-purchase limit raised to USD 2,500.00", outcome: "Approved" },
  ],
  "5176": [],
};
