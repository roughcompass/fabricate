export const FOLDERS = ["Financials", "Legal", "Due diligence", "Management presentation"] as const;

export type Folder = (typeof FOLDERS)[number];

export interface DealDocument {
  id: string;
  name: string;
  folder: Folder;
  format: "PDF" | "XLSX" | "DOCX" | "PPTX";
  updated: string;
  version: string;
  reviewer: string;
  /** How far the reviewer has got. */
  review: "Approved" | "In review" | "Changes requested";
}

export interface OpenItem {
  id: string;
  title: string;
  owner: string;
  due: string;
  raisedBy: string;
}

export const DEAL = "Project Halcyon, acquisition of Northwind Logistics Inc.";

export const TEAM = ["Tomás Herrera", "Aisha Rahman", "Daniel Novak", "Claire Dubois", "Kwame Asante"] as const;

export const DOCUMENTS: readonly DealDocument[] = [
  { id: "cim", name: "Confidential information memorandum", folder: "Management presentation", format: "PDF", updated: "10 Nov 2026", version: "v4", reviewer: "Aisha Rahman", review: "Approved" },
  { id: "mgmt", name: "Management presentation deck", folder: "Management presentation", format: "PPTX", updated: "14 Nov 2026", version: "v2", reviewer: "Tomás Herrera", review: "In review" },
  { id: "model", name: "Financial model, base case", folder: "Financials", format: "XLSX", updated: "16 Nov 2026", version: "v7", reviewer: "Daniel Novak", review: "Changes requested" },
  { id: "qoe", name: "Quality of earnings report", folder: "Financials", format: "PDF", updated: "12 Nov 2026", version: "v1", reviewer: "Daniel Novak", review: "In review" },
  { id: "audit", name: "Audited accounts FY2025", folder: "Financials", format: "PDF", updated: "02 Nov 2026", version: "v1", reviewer: "Aisha Rahman", review: "Approved" },
  { id: "spa", name: "Share purchase agreement", folder: "Legal", format: "DOCX", updated: "15 Nov 2026", version: "v5", reviewer: "Claire Dubois", review: "Changes requested" },
  { id: "disclosure", name: "Disclosure letter", folder: "Legal", format: "DOCX", updated: "13 Nov 2026", version: "v2", reviewer: "Claire Dubois", review: "In review" },
  { id: "tax", name: "Tax due diligence report", folder: "Due diligence", format: "PDF", updated: "11 Nov 2026", version: "v2", reviewer: "Kwame Asante", review: "In review" },
  { id: "commercial", name: "Commercial due diligence report", folder: "Due diligence", format: "PDF", updated: "06 Nov 2026", version: "v3", reviewer: "Tomás Herrera", review: "Approved" },
];

/** Open items on each document, oldest first. */
export const OPEN_ITEMS: Readonly<Record<string, readonly OpenItem[]>> = {
  cim: [],
  mgmt: [{ id: "i1", title: "Update the customer concentration slide with Q3 figures", owner: "Aisha Rahman", due: "19 Nov 2026", raisedBy: "Tomás Herrera" }],
  model: [
    { id: "i1", title: "Reconcile FY2025 EBITDA with the audited accounts", owner: "Daniel Novak", due: "18 Nov 2026", raisedBy: "Aisha Rahman" },
    { id: "i2", title: "Add a downside case at 5% lower volumes", owner: "Daniel Novak", due: "21 Nov 2026", raisedBy: "Tomás Herrera" },
    { id: "i3", title: "Show working capital by month, not quarter", owner: "Kwame Asante", due: "24 Nov 2026", raisedBy: "Daniel Novak" },
  ],
  qoe: [{ id: "i1", title: "Explain the one-off restructuring costs in note 4", owner: "Daniel Novak", due: "20 Nov 2026", raisedBy: "Aisha Rahman" }],
  audit: [],
  spa: [
    { id: "i1", title: "Agree the locked box date with the seller's counsel", owner: "Claire Dubois", due: "18 Nov 2026", raisedBy: "Tomás Herrera" },
    { id: "i2", title: "Cap warranty claims at 20% of the price", owner: "Claire Dubois", due: "22 Nov 2026", raisedBy: "Claire Dubois" },
  ],
  disclosure: [{ id: "i1", title: "List the pending litigation in Texas", owner: "Claire Dubois", due: "25 Nov 2026", raisedBy: "Kwame Asante" }],
  tax: [{ id: "i1", title: "Confirm the transfer pricing position for the Mexico entity", owner: "Kwame Asante", due: "21 Nov 2026", raisedBy: "Claire Dubois" }],
  commercial: [],
};
