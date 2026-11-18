import type { AppDefinition, BrandId, GroupMember } from "./types";

/**
 * The portal shell of each brand: every application's default microfrontend.
 * Shells are platform-owned, so a dev environment application serves them
 * from production as a fallback.
 */
export const SHELL_MEMBERS: Readonly<Record<BrandId, GroupMember>> = {
  payments: shell("payments-shell", "Access shell for Payments", "Payments Platform", "5.2.0", 160),
  "global-banking": shell("global-banking-shell", "Access shell for Global Banking", "Global Banking Platform", "8.0.3", 180),
  markets: shell("markets-shell", "Markets shell", "Markets Platform", "12.4.0", 150),
  other: shell("other-shell", "Access shell for Workplace", "Workplace Platform", "2.9.1", 170),
};

function shell(id: string, name: string, owner: string, version: string, loadMs: number): GroupMember {
  return {
    id,
    name,
    role: "default",
    owner,
    routing: { kind: "shell" },
    versions: [{ version, summary: "Current portal shell" }],
    defaultVersion: version,
    loadMs,
    swapMs: loadMs,
  };
}

// Each hero satisfies one contract (portal-runtime spec): at least three child
// members; one member with three versions, including a prerelease, that differ
// visibly; one member whose scripted load is the slowest; a bus publisher and a
// different subscriber; and content that changes for the Approver role. Every
// version is clean Salt; the reference deployment starts on the oldest stable
// version of the three-version member, so a swap shows a visible change.

export const PAYMENTS_APP: AppDefinition = {
  members: [
    SHELL_MEMBERS.payments,
    {
      id: "payee-list",
      name: "Payee list",
      role: "child",
      owner: "Payments Experience",
      routing: { kind: "route", path: "payees" },
      versions: [
        { version: "1.4.2", summary: "Compact table with inline search and named icon actions" },
        { version: "2.0.0", summary: "Table with a labeled search and text actions" },
        { version: "2.1.0-beta.1", prerelease: true, summary: "Card layout with favorite payees pinned first" },
      ],
      defaultVersion: "1.4.2",
      loadMs: 420,
      swapMs: 450,
      publishes: ["payee:selected"],
    },
    {
      id: "transfer-form",
      name: "Transfer form",
      role: "child",
      owner: "Payments Experience",
      routing: { kind: "slot", route: "payees", slot: "Sidebar" },
      versions: [
        { version: "3.0.1", summary: "Single-step transfer" },
        { version: "3.1.0", summary: "Adds a payment reference and a review step" },
      ],
      defaultVersion: "3.0.1",
      loadMs: 380,
      swapMs: 400,
      subscribes: ["payee:selected"],
    },
    {
      id: "payment-activity",
      name: "Payment activity",
      role: "child",
      owner: "Payments Operations",
      routing: { kind: "route", path: "activity" },
      versions: [{ version: "2.3.0", summary: "Daily activity with running totals" }],
      defaultVersion: "2.3.0",
      loadMs: 1300,
      swapMs: 900,
      roleDependent: true,
    },
  ],
  routes: [
    {
      path: "payees",
      label: "Payees",
      owner: "payee-list",
      regions: [
        { member: "payee-list", area: "main" },
        { member: "transfer-form", area: "side" },
        { member: "payment-activity", area: "wide" },
      ],
    },
    { path: "activity", label: "Activity", owner: "payment-activity", regions: [{ member: "payment-activity", area: "main" }] },
  ],
};

export const GLOBAL_BANKING_APP: AppDefinition = {
  members: [
    SHELL_MEMBERS["global-banking"],
    {
      id: "client-search",
      name: "Client search",
      role: "child",
      owner: "Client Experience",
      routing: { kind: "route", path: "clients" },
      versions: [
        { version: "4.1.0", summary: "Search with recently viewed clients" },
        { version: "4.2.0", summary: "Adds segment filters" },
      ],
      defaultVersion: "4.1.0",
      loadMs: 360,
      swapMs: 380,
      publishes: ["client:selected"],
    },
    {
      id: "kyc-checklist",
      name: "KYC checklist",
      role: "child",
      owner: "Onboarding Controls",
      routing: { kind: "slot", route: "clients", slot: "Sidebar" },
      versions: [
        { version: "3.2.0", summary: "Dense checklist with named icon actions" },
        { version: "3.3.0", summary: "Checklist with text actions and a reviewer note" },
        { version: "4.0.0-rc.1", prerelease: true, summary: "Grouped steps with a progress summary" },
      ],
      defaultVersion: "3.2.0",
      loadMs: 440,
      swapMs: 460,
      subscribes: ["client:selected"],
    },
    {
      id: "document-review",
      name: "Document review",
      role: "child",
      owner: "Onboarding Operations",
      routing: { kind: "route", path: "documents" },
      versions: [{ version: "1.6.0", summary: "Document queue with status and due dates" }],
      defaultVersion: "1.6.0",
      loadMs: 1250,
      swapMs: 850,
      roleDependent: true,
    },
  ],
  routes: [
    {
      path: "clients",
      label: "Clients",
      owner: "client-search",
      regions: [
        { member: "client-search", area: "main" },
        { member: "kyc-checklist", area: "side" },
        { member: "document-review", area: "wide" },
      ],
    },
    { path: "documents", label: "Documents", owner: "document-review", regions: [{ member: "document-review", area: "main" }] },
  ],
};

export const MARKETS_APP: AppDefinition = {
  members: [
    SHELL_MEMBERS.markets,
    {
      id: "watchlist",
      name: "Watchlist",
      role: "child",
      owner: "Markets Experience",
      routing: { kind: "route", path: "watch" },
      versions: [
        { version: "1.8.0", summary: "Dense price grid with named icon actions" },
        { version: "1.9.0", summary: "Adds a filter and text actions" },
        { version: "2.0.0-beta.2", prerelease: true, summary: "Price tiles with daily change bars" },
      ],
      defaultVersion: "1.8.0",
      loadMs: 340,
      swapMs: 380,
      publishes: ["instrument:selected"],
    },
    {
      id: "order-ticket",
      name: "Order ticket",
      role: "child",
      owner: "Execution Services",
      routing: { kind: "slot", route: "watch", slot: "Sidebar" },
      versions: [{ version: "2.2.0", summary: "Limit and market orders" }],
      defaultVersion: "2.2.0",
      loadMs: 300,
      swapMs: 320,
      subscribes: ["instrument:selected"],
    },
    {
      id: "price-chart",
      name: "Price chart",
      role: "child",
      owner: "Market Data",
      routing: { kind: "slot", route: "watch", slot: "Chart" },
      versions: [
        { version: "5.0.0", summary: "Line chart with a range selector" },
        { version: "5.1.0", summary: "Area chart with volume bars" },
      ],
      defaultVersion: "5.0.0",
      loadMs: 520,
      swapMs: 540,
      subscribes: ["instrument:selected"],
    },
    {
      id: "trade-blotter",
      name: "Trade blotter",
      role: "child",
      owner: "Trading Operations",
      routing: { kind: "route", path: "blotter" },
      versions: [{ version: "3.5.0", summary: "Live blotter with allocations" }],
      defaultVersion: "3.5.0",
      loadMs: 1350,
      swapMs: 900,
      roleDependent: true,
    },
  ],
  routes: [
    {
      path: "watch",
      label: "Watch",
      owner: "watchlist",
      regions: [
        { member: "watchlist", area: "main" },
        { member: "order-ticket", area: "side" },
        { member: "price-chart", area: "wide" },
        { member: "trade-blotter", area: "wide" },
      ],
    },
    { path: "blotter", label: "Blotter", owner: "trade-blotter", regions: [{ member: "trade-blotter", area: "main" }] },
  ],
};

export const OPERATIONS_APP: AppDefinition = {
  members: [
    SHELL_MEMBERS.other,
    {
      id: "incident-feed",
      name: "Incident feed",
      role: "child",
      owner: "Site Reliability",
      routing: { kind: "route", path: "incidents" },
      versions: [
        { version: "6.0.0", summary: "Incident list with named icon actions" },
        { version: "6.1.0", summary: "Adds a severity filter and text actions" },
        { version: "7.0.0-alpha.3", prerelease: true, summary: "Timeline view grouped by severity" },
      ],
      defaultVersion: "6.0.0",
      loadMs: 380,
      swapMs: 400,
      publishes: ["incident:selected"],
    },
    {
      id: "service-health",
      name: "Service health",
      role: "child",
      owner: "Observability",
      routing: { kind: "slot", route: "incidents", slot: "Sidebar" },
      versions: [{ version: "2.4.0", summary: "Status grid by region" }],
      defaultVersion: "2.4.0",
      loadMs: 410,
      swapMs: 420,
      subscribes: ["incident:selected"],
    },
    {
      id: "change-calendar",
      name: "Change calendar",
      role: "child",
      owner: "Change Management",
      routing: { kind: "route", path: "changes" },
      versions: [{ version: "1.2.0", summary: "Weekly change calendar" }],
      defaultVersion: "1.2.0",
      loadMs: 1280,
      swapMs: 880,
      roleDependent: true,
    },
  ],
  routes: [
    {
      path: "incidents",
      label: "Incidents",
      owner: "incident-feed",
      regions: [
        { member: "incident-feed", area: "main" },
        { member: "service-health", area: "side" },
        { member: "change-calendar", area: "wide" },
      ],
    },
    { path: "changes", label: "Changes", owner: "change-calendar", regions: [{ member: "change-calendar", area: "main" }] },
  ],
};
