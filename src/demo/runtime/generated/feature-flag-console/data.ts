export type Environment = "development" | "sandbox" | "production";

export interface FlagState {
  enabled: boolean;
  /** The share of users who get the feature while the flag is on, as a percentage. */
  rollout: number;
}

export interface Flag {
  id: string;
  key: string;
  name: string;
  description: string;
  owner: string;
  team: string;
  updated: string;
  environments: Readonly<Record<Environment, FlagState>>;
}

export const ENVIRONMENTS: readonly { id: Environment; label: string }[] = [
  { id: "development", label: "Development" },
  { id: "sandbox", label: "Sandbox" },
  { id: "production", label: "Production" },
];

export const FLAGS: readonly Flag[] = [
  {
    id: "instant-refunds",
    key: "payments.instant-refunds",
    name: "Instant refunds",
    description: "Refunds card payments to the original card in seconds instead of three to five days.",
    owner: "Ravi Shah",
    team: "Payments",
    updated: "16 Oct 2026, 11:05 ET",
    environments: { development: { enabled: true, rollout: 100 }, sandbox: { enabled: true, rollout: 100 }, production: { enabled: true, rollout: 25 } },
  },
  {
    id: "guided-onboarding",
    key: "onboarding.guided-flow",
    name: "Guided onboarding",
    description: "Walks new business clients through account setup in five steps.",
    owner: "Lena Fischer",
    team: "Digital channels",
    updated: "14 Oct 2026, 16:40 ET",
    environments: { development: { enabled: true, rollout: 100 }, sandbox: { enabled: true, rollout: 100 }, production: { enabled: true, rollout: 100 } },
  },
  {
    id: "fx-quote-stream",
    key: "markets.fx-quote-stream",
    name: "Streaming FX quotes",
    description: "Streams executable FX quotes to the client portal instead of refreshing every 30 seconds.",
    owner: "Kenji Watanabe",
    team: "Markets technology",
    updated: "16 Oct 2026, 09:12 ET",
    environments: { development: { enabled: true, rollout: 100 }, sandbox: { enabled: true, rollout: 50 }, production: { enabled: false, rollout: 5 } },
  },
  {
    id: "statement-summaries",
    key: "statements.ai-summary",
    name: "Statement summaries",
    description: "Adds a generated summary of spending and fees to the top of monthly statements.",
    owner: "Amara Osei",
    team: "Statements",
    updated: "15 Oct 2026, 13:25 ET",
    environments: { development: { enabled: true, rollout: 100 }, sandbox: { enabled: false, rollout: 20 }, production: { enabled: false, rollout: 10 } },
  },
  {
    id: "card-controls-v2",
    key: "cards.controls-v2",
    name: "Card controls v2",
    description: "Lets cardholders set merchant and country rules from the mobile app.",
    owner: "Priya Natarajan",
    team: "Cards",
    updated: "13 Oct 2026, 10:50 ET",
    environments: { development: { enabled: true, rollout: 100 }, sandbox: { enabled: true, rollout: 100 }, production: { enabled: true, rollout: 60 } },
  },
  {
    id: "dark-mode-default",
    key: "ui.dark-mode-default",
    name: "Dark mode by default",
    description: "Opens the client portal in dark mode when the device prefers it.",
    owner: "Sofia Marques",
    team: "Design systems",
    updated: "12 Oct 2026, 15:05 ET",
    environments: { development: { enabled: true, rollout: 100 }, sandbox: { enabled: true, rollout: 100 }, production: { enabled: true, rollout: 10 } },
  },
  {
    id: "dual-batch-approval",
    key: "payments.dual-batch-approval",
    name: "Dual approval for batches",
    description: "Requires a second approver for payment batches over USD 250,000.00.",
    owner: "Marco Bianchi",
    team: "Payments",
    updated: "9 Oct 2026, 08:30 ET",
    environments: { development: { enabled: true, rollout: 100 }, sandbox: { enabled: true, rollout: 100 }, production: { enabled: true, rollout: 100 } },
  },
  {
    id: "legacy-csv-export",
    key: "reports.legacy-csv-export",
    name: "Legacy CSV export",
    description: "Keeps the old CSV export while clients move to the new reports API. Retires on 30 Nov 2026.",
    owner: "Daniel Reyes",
    team: "Reporting",
    updated: "2 Oct 2026, 12:00 ET",
    environments: { development: { enabled: false, rollout: 100 }, sandbox: { enabled: false, rollout: 100 }, production: { enabled: true, rollout: 100 } },
  },
];
