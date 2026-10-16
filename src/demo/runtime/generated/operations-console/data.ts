export interface Incident {
  id: string;
  title: string;
  severity: "SEV1" | "SEV2" | "SEV3";
  region: string;
  opened: string;
}

export const INCIDENTS: readonly Incident[] = [
  { id: "INC-2041", title: "Elevated latency on payments gateway", severity: "SEV2", region: "EMEA", opened: "09:12" },
  { id: "INC-2042", title: "Login failures for a subset of users", severity: "SEV1", region: "Americas", opened: "09:40" },
  { id: "INC-2043", title: "Delayed report generation", severity: "SEV3", region: "APAC", opened: "10:05" },
  { id: "INC-2044", title: "Search index rebuild running long", severity: "SEV3", region: "EMEA", opened: "10:31" },
];

export const REGIONS = ["Americas", "EMEA", "APAC"] as const;

export const SERVICES = [
  { name: "Gateway", status: { Americas: "Healthy", EMEA: "Degraded", APAC: "Healthy" } },
  { name: "Identity", status: { Americas: "Outage", EMEA: "Healthy", APAC: "Healthy" } },
  { name: "Reporting", status: { Americas: "Healthy", EMEA: "Healthy", APAC: "Degraded" } },
  { name: "Search", status: { Americas: "Healthy", EMEA: "Degraded", APAC: "Healthy" } },
] as const;

export const CHANGES = [
  { id: "CHG-731", title: "Rotate gateway certificates", window: "Tue 22:00", risk: "Low", status: "Scheduled" },
  { id: "CHG-732", title: "Upgrade identity provider", window: "Wed 21:00", risk: "High", status: "Awaiting approval" },
  { id: "CHG-733", title: "Resize reporting cluster", window: "Thu 20:00", risk: "Medium", status: "Awaiting approval" },
] as const;
