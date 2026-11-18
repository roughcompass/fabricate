export const STAGES = ["Initiated", "Screened", "Sent", "Settled"] as const;

export type Stage = (typeof STAGES)[number];

export interface Stall {
  /** When the payment stopped moving. */
  since: string;
  reason: string;
  /** What the payment's owner should do next. */
  action: string;
}

export interface Payment {
  id: string;
  reference: string;
  beneficiary: string;
  /** The beneficiary's account, masked. */
  account: string;
  currency: string;
  amount: number;
  rail: "SWIFT" | "Fedwire" | "ACH" | "SEPA" | "CHAPS";
  valueDate: string;
  /** The last stage the payment reached. */
  stage: Stage;
  /** When the payment reached each stage so far, in stage order. */
  times: readonly string[];
  stall?: Stall;
}

export const UPDATED = "14:30 ET";

export const PAYMENTS: readonly Payment[] = [
  { id: "20481", reference: "PAY-20481", beneficiary: "Halvorsen Shipping AS", account: "••••4821", currency: "USD", amount: 248000, rail: "SWIFT", valueDate: "17 Nov 2026", stage: "Screened", times: ["08:41 ET", "09:12 ET"], stall: { since: "09:12 ET", reason: "Held by the correspondent bank for a beneficiary name mismatch.", action: "Confirm the beneficiary's registered name with the client, then ask operations to resubmit." } },
  { id: "20477", reference: "PAY-20477", beneficiary: "Brightwater Utilities", account: "••••0193", currency: "USD", amount: 12400, rail: "ACH", valueDate: "17 Nov 2026", stage: "Settled", times: ["07:02 ET", "07:05 ET", "07:30 ET", "11:00 ET"] },
  { id: "20475", reference: "PAY-20475", beneficiary: "Kestrel Components GmbH", account: "••••7720", currency: "EUR", amount: 86350.5, rail: "SEPA", valueDate: "17 Nov 2026", stage: "Sent", times: ["06:48 ET", "06:52 ET", "07:15 ET"] },
  { id: "20470", reference: "PAY-20470", beneficiary: "Marlow & Finch LLP", account: "••••3306", currency: "GBP", amount: 41275, rail: "CHAPS", valueDate: "17 Nov 2026", stage: "Initiated", times: ["10:05 ET"], stall: { since: "10:05 ET", reason: "Waiting on sanctions screening for longer than the 30-minute target.", action: "Escalate to payment operations so a screening analyst reviews it before the CHAPS cut-off at 11:00 ET." } },
  { id: "20468", reference: "PAY-20468", beneficiary: "Northwind Logistics Inc.", account: "••••5512", currency: "USD", amount: 1250000, rail: "Fedwire", valueDate: "17 Nov 2026", stage: "Settled", times: ["08:00 ET", "08:04 ET", "08:06 ET", "08:07 ET"] },
  { id: "20466", reference: "PAY-20466", beneficiary: "Sakura Precision KK", account: "••••8840", currency: "USD", amount: 395600, rail: "SWIFT", valueDate: "18 Nov 2026", stage: "Sent", times: ["09:30 ET", "09:41 ET", "10:02 ET"] },
  { id: "20463", reference: "PAY-20463", beneficiary: "Oakridge Facilities Ltd", account: "••••2267", currency: "GBP", amount: 8920.4, rail: "CHAPS", valueDate: "17 Nov 2026", stage: "Screened", times: ["10:20 ET", "10:24 ET"] },
  { id: "20459", reference: "PAY-20459", beneficiary: "Cobalt Data Systems", account: "••••9014", currency: "USD", amount: 57300, rail: "ACH", valueDate: "18 Nov 2026", stage: "Initiated", times: ["13:55 ET"] },
];

/** What each stage means, for people following a payment. */
export const STAGE_DETAIL: Readonly<Record<Stage, string>> = {
  Initiated: "Created and approved by the client",
  Screened: "Cleared sanctions and fraud screening",
  Sent: "Released to the payment network",
  Settled: "Credited to the beneficiary's bank",
};
