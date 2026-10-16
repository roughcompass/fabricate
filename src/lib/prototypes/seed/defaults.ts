import type { PersonaFields, Scope, ShellConfig } from "../types";

/**
 * What every new workspace starts with before any generated example: five
 * fictional financial-institution personas (personas spec, "Five fictional
 * financial-institution personas are seeded"), the default page shell for a
 * fictional corporate banking portal (page-shell spec, "The shell's contents
 * are workspace data"), and three benchmark intents (learning spec,
 * "Benchmark intents are workspace data"). Every name, organization, and
 * figure here is invented.
 */

export interface SeedPersona extends PersonaFields {
  /** A stable key, so seeded prototypes and lessons can refer to a persona before ids are assigned. */
  readonly key: "payments-approver" | "treasurer" | "sales-trader" | "kyc-analyst" | "relationship-banker";
}

export const SEED_PERSONAS: readonly SeedPersona[] = [
  {
    key: "payments-approver",
    name: "Maya Lindqvist",
    role: "Treasury payments approver",
    organizationType: "Corporate treasury at a mid-sized manufacturer",
    goals: ["Release today's urgent payments before each currency's cut-off", "Spot duplicate or unusual payments before approving them"],
    context: "Approves 40 to 120 supplier and payroll payments a day, mostly between meetings, often on a phone. Cut-offs are 15:00 London for GBP and EUR, and 14:00 New York for USD.",
    constraints: ["Four-eyes approval on payments over USD 1m", "Can't release a payment she created", "Must see the beneficiary's account before approving"],
    distinction: "Approves payments others prepare; she doesn't create them or manage liquidity.",
  },
  {
    key: "treasurer",
    name: "Daniel Okafor",
    role: "Group treasurer",
    organizationType: "Corporate treasury at a retail group with 14 entities",
    goals: ["Know the group's cash position across 23 accounts and 6 currencies by 09:00", "Fund shortfalls and sweep surpluses before they cost interest"],
    context: "Works from a desktop with two screens. Reviews intraday balances, then decides sweeps and short-term funding with the funding desk.",
    constraints: ["Intraday balances lag by up to 15 minutes", "Some subsidiaries' accounts are view-only for him", "Every sweep needs an audit reason"],
    distinction: "Manages liquidity across accounts; he rarely approves individual payments.",
  },
  {
    key: "sales-trader",
    name: "Sofia Marchetti",
    role: "FX and rates sales-trader",
    organizationType: "Markets division of a global bank",
    goals: ["Quote client requests for quote within seconds", "See each client's recent activity and axes before calling them"],
    context: "Covers 30 corporate and asset-manager clients. Lives on a dense multi-monitor desk and works mostly from the keyboard.",
    constraints: ["Quotes expire after 10 seconds", "Must not see other desks' client positions", "Needs every figure without scrolling"],
    distinction: "Speed-first and keyboard-first, unlike the corporate client personas.",
  },
  {
    key: "kyc-analyst",
    name: "Wei Chen",
    role: "Client onboarding (KYC) analyst",
    organizationType: "Client onboarding team at a corporate bank",
    goals: ["Clear onboarding cases within the 10-day service level", "See exactly which documents block each case"],
    context: "Works a queue of 25 to 40 open cases, requesting documents from clients and relationship bankers, and evidencing each check for audit.",
    constraints: ["Every decision needs a recorded reason and evidence", "A second analyst must approve high-risk clients", "Can't contact clients directly about sanctions screening"],
    distinction: "Works cases, not payments or markets; evidence and audit trail matter most.",
  },
  {
    key: "relationship-banker",
    name: "Amara Haddad",
    role: "Corporate relationship banker",
    organizationType: "Commercial banking coverage team",
    goals: ["Prepare for a client meeting in five minutes", "See a client's products, open service issues, and onboarding status in one place"],
    context: "Covers 45 mid-sized corporate clients, often between client visits, using a tablet.",
    constraints: ["Can't see restricted compliance data", "Needs to share a summary with the client without exposing internal notes"],
    distinction: "Client-facing and summary-first; she hands detailed work to specialists.",
  },
];

export const DEFAULT_SHELL: ShellConfig = {
  appName: "Meridian Corporate Banking",
  nav: [
    { label: "Overview", children: [] },
    { label: "Payments", children: ["Approvals", "Payment history", "Beneficiaries"] },
    { label: "Accounts", children: ["Balances", "Statements"] },
    { label: "Liquidity", children: ["Cash position", "Sweeps", "Forecast"] },
    { label: "Reports", children: ["Scheduled reports", "Exports"] },
  ],
  footerText: "Meridian Corporate Banking is a fictional service. Every name and figure is invented.",
  footerLinks: [
    { label: "Help", href: "#help" },
    { label: "Security", href: "#security" },
    { label: "Accessibility", href: "#accessibility" },
    { label: "Terms of use", href: "#terms" },
  ],
};

export interface SeedBenchmark {
  readonly intent: string;
  readonly scope: Scope;
  readonly personas: readonly SeedPersona["key"][];
}

export const SEED_BENCHMARKS: readonly SeedBenchmark[] = [
  { intent: "Review and release today's urgent payments before cut-off", scope: "page", personas: ["payments-approver"] },
  { intent: "See the group's cash position across accounts and currencies, and spot where funding is short", scope: "page", personas: ["treasurer"] },
  { intent: "Show what an onboarding case is still missing and who needs to act on it", scope: "component", personas: ["kyc-analyst"] },
];

/** The fictional user a page's header shows when its version has no persona (page-shell spec). */
export const GENERIC_USER = { name: "Alex Morgan", role: "Corporate banking user" } as const;
