export interface Client {
  id: string;
  name: string;
  segment: string;
  country: string;
  stage: string;
  /** When the signed-in user last opened the client. */
  viewed: string;
}

export const CLIENTS: readonly Client[] = [
  { id: "halcyon", name: "Halcyon Maritime Ltd", segment: "Corporate", country: "Singapore", stage: "KYC review", viewed: "16 Oct 2026, 09:12 ET" },
  { id: "orchard", name: "Orchard Lane Partners", segment: "Financial institution", country: "United Kingdom", stage: "Documents", viewed: "15 Oct 2026, 16:40 ET" },
  { id: "tessera", name: "Tessera Robotics", segment: "Corporate", country: "Germany", stage: "KYC review", viewed: "15 Oct 2026, 11:05 ET" },
  { id: "meridian", name: "Meridian Agri Holdings", segment: "Commercial", country: "Brazil", stage: "Screening", viewed: "14 Oct 2026, 14:30 ET" },
  { id: "polaris", name: "Polaris Health Group", segment: "Corporate", country: "Canada", stage: "Approved", viewed: "12 Oct 2026, 10:18 ET" },
];

export interface Check {
  id: string;
  label: string;
  /** The step group the grouped checklist shows the check under. */
  group: string;
  done: boolean;
}

export const CHECKS: Check[] = [
  { id: "identity", label: "Verify legal entity identity", group: "Entity and ownership", done: true },
  { id: "ownership", label: "Confirm beneficial ownership", group: "Entity and ownership", done: true },
  { id: "sanctions", label: "Screen against sanctions lists", group: "Screening and risk", done: false },
  { id: "source", label: "Document source of funds", group: "Screening and risk", done: false },
  { id: "risk", label: "Assign a risk rating", group: "Screening and risk", done: false },
];

export const DOCUMENTS = [
  { id: "DOC-1042", name: "Certificate of incorporation", client: "Halcyon Maritime Ltd", due: "19 Oct 2026", status: "Received" },
  { id: "DOC-1043", name: "Register of directors", client: "Halcyon Maritime Ltd", due: "19 Oct 2026", status: "Awaiting review" },
  { id: "DOC-1051", name: "Proof of address", client: "Tessera Robotics", due: "21 Oct 2026", status: "Awaiting review" },
  { id: "DOC-1060", name: "Audited financials 2025", client: "Orchard Lane Partners", due: "26 Oct 2026", status: "Missing" },
] as const;
