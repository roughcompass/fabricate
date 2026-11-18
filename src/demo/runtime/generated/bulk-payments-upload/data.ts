export type Validation = "Passed" | "Passed with warnings" | "Failed";

export interface PaymentFile {
  id: string;
  name: string;
  format: "CSV" | "ISO 20022 XML";
  uploadedBy: string;
  uploadedAt: string;
  lines: number;
  currency: string;
  total: number;
  validation: Validation;
}

export interface LineIssue {
  line: number;
  beneficiary: string;
  problem: string;
  severity: "Error" | "Warning";
}

export interface Batch {
  id: string;
  name: string;
  valueDate: string;
  lines: number;
  total: number;
  /** Why the batch can't be released yet; absent when it's ready. */
  held?: string;
}

export const DEBIT_ACCOUNT = "Operating account ••••4821";

export const FILES: readonly PaymentFile[] = [
  { id: "1107", name: "payroll-nov-2026.csv", format: "CSV", uploadedBy: "Elena Petrova", uploadedAt: "17 Nov 2026, 09:14 ET", lines: 412, currency: "USD", total: 1846220.55, validation: "Passed" },
  { id: "1106", name: "suppliers-wk46.xml", format: "ISO 20022 XML", uploadedBy: "Marco Bianchi", uploadedAt: "17 Nov 2026, 08:52 ET", lines: 86, currency: "EUR", total: 642310.0, validation: "Failed" },
  { id: "1104", name: "contractors-nov-2026.csv", format: "CSV", uploadedBy: "Elena Petrova", uploadedAt: "16 Nov 2026, 16:40 ET", lines: 57, currency: "USD", total: 218904.3, validation: "Passed with warnings" },
  { id: "1101", name: "tax-remittances-q4.xml", format: "ISO 20022 XML", uploadedBy: "Samuel Adeyemi", uploadedAt: "16 Nov 2026, 11:05 ET", lines: 12, currency: "USD", total: 1204500.0, validation: "Passed" },
  { id: "1098", name: "uk-suppliers-wk46.csv", format: "CSV", uploadedBy: "Marco Bianchi", uploadedAt: "15 Nov 2026, 14:22 ET", lines: 133, currency: "GBP", total: 389775.2, validation: "Failed" },
  { id: "1095", name: "expenses-oct-2026.csv", format: "CSV", uploadedBy: "Hana Kim", uploadedAt: "14 Nov 2026, 10:31 ET", lines: 248, currency: "USD", total: 96412.85, validation: "Passed with warnings" },
];

/** Line-level validation results for each file, in line order. */
export const ISSUES: Readonly<Record<string, readonly LineIssue[]>> = {
  "1107": [],
  "1106": [
    { line: 14, beneficiary: "Kestrel Components GmbH", problem: "IBAN check digits don't match", severity: "Error" },
    { line: 37, beneficiary: "Vasco Ferreira Lda", problem: "BIC is missing", severity: "Error" },
    { line: 52, beneficiary: "Lumen Optik AG", problem: "Duplicate of line 49", severity: "Warning" },
    { line: 71, beneficiary: "Atelier Rousseau SARL", problem: "Value date is a TARGET2 holiday", severity: "Error" },
  ],
  "1104": [
    { line: 9, beneficiary: "Jordan Ellis", problem: "Amount is 4 times this payee's average", severity: "Warning" },
    { line: 33, beneficiary: "Mei Lin Consulting", problem: "New payee, first payment", severity: "Warning" },
  ],
  "1101": [],
  "1098": [
    { line: 6, beneficiary: "Oakridge Facilities Ltd", problem: "Sort code isn't recognized", severity: "Error" },
    { line: 88, beneficiary: "Pennine Haulage", problem: "Account name doesn't match the payee's bank", severity: "Error" },
    { line: 120, beneficiary: "Wren & Daughters", problem: "Reference is longer than 18 characters", severity: "Warning" },
  ],
  "1095": [{ line: 201, beneficiary: "Daniel Novak", problem: "Expense claim older than 90 days", severity: "Warning" }],
};

/** How each file splits into batches, by value date and approval group. */
export const BATCHES: Readonly<Record<string, readonly Batch[]>> = {
  "1107": [
    { id: "b1", name: "Salaried staff", valueDate: "20 Nov 2026", lines: 368, total: 1702114.2 },
    { id: "b2", name: "Hourly staff", valueDate: "20 Nov 2026", lines: 44, total: 144106.35 },
  ],
  "1106": [
    { id: "b1", name: "Eurozone suppliers", valueDate: "19 Nov 2026", lines: 61, total: 488920.0, held: "3 lines fail validation" },
    { id: "b2", name: "Non-euro suppliers", valueDate: "19 Nov 2026", lines: 25, total: 153390.0 },
  ],
  "1104": [
    { id: "b1", name: "US contractors", valueDate: "18 Nov 2026", lines: 41, total: 162330.1 },
    { id: "b2", name: "International contractors", valueDate: "19 Nov 2026", lines: 16, total: 56574.2 },
  ],
  "1101": [{ id: "b1", name: "Federal and state tax", valueDate: "18 Nov 2026", lines: 12, total: 1204500.0 }],
  "1098": [
    { id: "b1", name: "Faster Payments", valueDate: "18 Nov 2026", lines: 97, total: 154210.6, held: "1 line fails validation" },
    { id: "b2", name: "CHAPS", valueDate: "18 Nov 2026", lines: 36, total: 235564.6, held: "1 line fails validation" },
  ],
  "1095": [{ id: "b1", name: "Employee reimbursements", valueDate: "18 Nov 2026", lines: 248, total: 96412.85 }],
};
