export interface Incident {
  id: string;
  title: string;
  severity: "SEV1" | "SEV2" | "SEV3";
  region: string;
  /** The service the incident affects. */
  service: string;
  /** When the incident opened, Eastern. */
  opened: string;
}

/** When the incident feed and service health were last updated. */
export const UPDATED = "10:42 ET";

export const INCIDENTS: readonly Incident[] = [
  { id: "INC-2041", title: "Elevated latency on payments gateway", severity: "SEV2", region: "EMEA", service: "Gateway", opened: "09:12 ET" },
  { id: "INC-2042", title: "Login failures for a subset of users", severity: "SEV1", region: "Americas", service: "Identity", opened: "09:40 ET" },
  { id: "INC-2043", title: "Delayed report generation", severity: "SEV3", region: "APAC", service: "Reporting", opened: "10:05 ET" },
  { id: "INC-2044", title: "Search index rebuild running long", severity: "SEV3", region: "EMEA", service: "Search", opened: "10:31 ET" },
];

/** What each severity means, for headings and options. */
export const SEVERITIES = [
  { value: "SEV1", label: "SEV1", meaning: "Critical" },
  { value: "SEV2", label: "SEV2", meaning: "Major" },
  { value: "SEV3", label: "SEV3", meaning: "Minor" },
] as const;

export const REGIONS = ["Americas", "EMEA", "APAC"] as const;

export const SERVICES = [
  { name: "Gateway", status: { Americas: "Healthy", EMEA: "Degraded", APAC: "Healthy" } },
  { name: "Identity", status: { Americas: "Outage", EMEA: "Healthy", APAC: "Healthy" } },
  { name: "Reporting", status: { Americas: "Healthy", EMEA: "Healthy", APAC: "Degraded" } },
  { name: "Search", status: { Americas: "Healthy", EMEA: "Degraded", APAC: "Healthy" } },
] as const;

/** The week the change calendar shows. */
export const WEEK = "19 Oct 2026";

export const CHANGES = [
  { id: "CHG-731", title: "Rotate gateway certificates", window: "Tue 20 Oct, 22:00–23:00 ET", owner: "Network Engineering", risk: "Low", status: "Scheduled" },
  { id: "CHG-732", title: "Upgrade identity provider", window: "Wed 21 Oct, 21:00–23:30 ET", owner: "Identity Platform", risk: "High", status: "Awaiting approval" },
  { id: "CHG-733", title: "Resize reporting cluster", window: "Thu 22 Oct, 20:00–21:00 ET", owner: "Data Platform", risk: "Medium", status: "Awaiting approval" },
] as const;
