export interface Facility {
  id: string;
  borrower: string;
  type: "Revolving credit facility" | "Term loan" | "Letter of credit" | "Bridge loan";
  currency: string;
  limit: number;
  drawn: number;
  maturity: string;
  /** The date of the next covenant test. */
  nextTest: string;
}

export type CovenantResult = "Pass" | "Watch" | "Breach";

export interface Covenant {
  id: string;
  name: string;
  /** The level the covenant requires, such as "At most 3.50x". */
  threshold: string;
  actual: string;
  tested: string;
  result: CovenantResult;
}

export const AS_OF = "17 Nov 2026";

/** Every facility is booked in US dollars, so the portfolio sums without conversion. */
export const FACILITIES: readonly Facility[] = [
  { id: "1042", borrower: "Northwind Logistics Inc.", type: "Revolving credit facility", currency: "USD", limit: 150000000, drawn: 96500000, maturity: "30 Jun 2029", nextTest: "31 Dec 2026" },
  { id: "1038", borrower: "Halvorsen Shipping AS", type: "Term loan", currency: "USD", limit: 220000000, drawn: 220000000, maturity: "15 Mar 2031", nextTest: "31 Dec 2026" },
  { id: "1031", borrower: "Brightwater Utilities", type: "Revolving credit facility", currency: "USD", limit: 75000000, drawn: 12000000, maturity: "28 Feb 2028", nextTest: "31 Jan 2027" },
  { id: "1027", borrower: "Kestrel Components GmbH", type: "Letter of credit", currency: "USD", limit: 25000000, drawn: 18400000, maturity: "31 Dec 2026", nextTest: "31 Dec 2026" },
  { id: "1024", borrower: "Cobalt Data Systems", type: "Bridge loan", currency: "USD", limit: 60000000, drawn: 57000000, maturity: "30 Apr 2027", nextTest: "30 Nov 2026" },
  { id: "1019", borrower: "Sakura Precision KK", type: "Revolving credit facility", currency: "USD", limit: 100000000, drawn: 41250000, maturity: "30 Sep 2028", nextTest: "31 Dec 2026" },
  { id: "1013", borrower: "Oakridge Facilities Ltd", type: "Term loan", currency: "USD", limit: 45000000, drawn: 38700000, maturity: "31 Aug 2030", nextTest: "31 Mar 2027" },
];

/** Each facility's financial covenants with their latest test. */
export const COVENANTS: Readonly<Record<string, readonly Covenant[]>> = {
  "1042": [
    { id: "lev", name: "Net leverage ratio", threshold: "At most 3.50x", actual: "2.85x", tested: "30 Sep 2026", result: "Pass" },
    { id: "icr", name: "Interest cover", threshold: "At least 4.00x", actual: "5.20x", tested: "30 Sep 2026", result: "Pass" },
    { id: "cap", name: "Capital expenditure", threshold: "At most USD 40,000,000.00 a year", actual: "USD 31,200,000.00", tested: "30 Sep 2026", result: "Pass" },
  ],
  "1038": [
    { id: "lev", name: "Net leverage ratio", threshold: "At most 4.00x", actual: "3.86x", tested: "30 Sep 2026", result: "Watch" },
    { id: "ltv", name: "Loan to vessel value", threshold: "At most 70%", actual: "66%", tested: "30 Sep 2026", result: "Pass" },
    { id: "liq", name: "Minimum liquidity", threshold: "At least USD 20,000,000.00", actual: "USD 24,800,000.00", tested: "30 Sep 2026", result: "Pass" },
  ],
  "1031": [
    { id: "lev", name: "Net leverage ratio", threshold: "At most 5.00x", actual: "3.10x", tested: "31 Oct 2026", result: "Pass" },
    { id: "dscr", name: "Debt service cover", threshold: "At least 1.30x", actual: "1.85x", tested: "31 Oct 2026", result: "Pass" },
  ],
  "1027": [{ id: "nw", name: "Tangible net worth", threshold: "At least USD 80,000,000.00", actual: "USD 92,400,000.00", tested: "30 Sep 2026", result: "Pass" }],
  "1024": [
    { id: "lev", name: "Net leverage ratio", threshold: "At most 3.00x", actual: "3.42x", tested: "31 Oct 2026", result: "Breach" },
    { id: "icr", name: "Interest cover", threshold: "At least 3.00x", actual: "3.15x", tested: "31 Oct 2026", result: "Watch" },
  ],
  "1019": [
    { id: "lev", name: "Net leverage ratio", threshold: "At most 3.25x", actual: "1.90x", tested: "30 Sep 2026", result: "Pass" },
    { id: "icr", name: "Interest cover", threshold: "At least 4.50x", actual: "8.70x", tested: "30 Sep 2026", result: "Pass" },
  ],
  "1013": [
    { id: "dscr", name: "Debt service cover", threshold: "At least 1.20x", actual: "1.24x", tested: "30 Sep 2026", result: "Watch" },
    { id: "lev", name: "Net leverage ratio", threshold: "At most 4.50x", actual: "3.95x", tested: "30 Sep 2026", result: "Pass" },
  ],
};
