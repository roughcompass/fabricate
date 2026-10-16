export interface Client {
  id: string;
  name: string;
  segment: string;
  country: string;
  stage: string;
}

export const CLIENTS: readonly Client[] = [
  { id: "halcyon", name: "Halcyon Maritime Ltd", segment: "Corporate", country: "Singapore", stage: "KYC review" },
  { id: "orchard", name: "Orchard Lane Partners", segment: "Financial institution", country: "United Kingdom", stage: "Documents" },
  { id: "tessera", name: "Tessera Robotics", segment: "Corporate", country: "Germany", stage: "KYC review" },
  { id: "meridian", name: "Meridian Agri Holdings", segment: "Commercial", country: "Brazil", stage: "Screening" },
  { id: "polaris", name: "Polaris Health Group", segment: "Corporate", country: "Canada", stage: "Approved" },
];

export const CHECKS = [
  { id: "identity", label: "Verify legal entity identity", done: true },
  { id: "ownership", label: "Confirm beneficial ownership", done: true },
  { id: "sanctions", label: "Screen against sanctions lists", done: false },
  { id: "source", label: "Document source of funds", done: false },
  { id: "risk", label: "Assign a risk rating", done: false },
];

export const DOCUMENTS = [
  { id: "DOC-1042", name: "Certificate of incorporation", client: "Halcyon Maritime Ltd", due: "Oct 2", status: "Received" },
  { id: "DOC-1043", name: "Register of directors", client: "Halcyon Maritime Ltd", due: "Oct 2", status: "Awaiting review" },
  { id: "DOC-1051", name: "Proof of address", client: "Tessera Robotics", due: "Oct 4", status: "Awaiting review" },
  { id: "DOC-1060", name: "Audited financials 2025", client: "Orchard Lane Partners", due: "Oct 9", status: "Missing" },
] as const;
