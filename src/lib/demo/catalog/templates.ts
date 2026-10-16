import { BRANDS } from "./brands";
import { GLOBAL_BANKING_APP, MARKETS_APP, OPERATIONS_APP, PAYMENTS_APP, genericApp } from "./heroes";
import type { AppDefinition, BrandId, ProviderId, Template } from "./types";

interface TemplateInput {
  slug: string;
  title: string;
  description: string;
  brand: BrandId;
  provider: ProviderId;
  author?: string;
  tags: string[];
  version: string;
  app?: AppDefinition;
}

function template(input: TemplateInput): Template {
  const owner = input.provider === "community" ? (input.author ?? "Community") : "DE Web Starter Kits";
  return {
    ...input,
    origin: "built-in",
    hero: input.app !== undefined,
    preview: {
      // Captured from the reference deployment by scripts/capture-template-previews.mjs.
      src: `/demo/previews/${input.slug}.jpg`,
      alt: `Preview of the ${input.title} template in the ${BRANDS[input.brand].portalName} portal`,
    },
    app: input.app ?? genericApp(input.brand, owner),
  };
}

/**
 * Every template in the gallery: one hero per brand, built to tell the full
 * toolbar story, and lighter templates that deploy into the shared generic
 * application so the gallery feels like a marketplace.
 */
export const TEMPLATES: readonly Template[] = [
  // Heroes
  template({
    slug: "payments-workspace",
    title: "Payments workspace",
    description: "Manage payees, send transfers, and review daily payment activity in J.P. Morgan Access.",
    brand: "payments",
    provider: "de-web",
    tags: ["payees", "transfers", "approvals"],
    version: "3.2.0",
    app: PAYMENTS_APP,
  }),
  template({
    slug: "client-onboarding",
    title: "Client onboarding",
    description: "Search clients, work through KYC checks, and review onboarding documents in J.P. Morgan Access.",
    brand: "global-banking",
    provider: "de-web",
    tags: ["onboarding", "kyc", "documents"],
    version: "2.4.1",
    app: GLOBAL_BANKING_APP,
  }),
  template({
    slug: "market-watch",
    title: "Market watch",
    description: "Follow instruments on a watchlist, chart prices, place orders, and track trades in J.P. Morgan Markets.",
    brand: "markets",
    provider: "de-web",
    tags: ["watchlist", "charts", "orders"],
    version: "4.0.2",
    app: MARKETS_APP,
  }),
  template({
    slug: "operations-console",
    title: "Operations console",
    description: "Track incidents, see service health by region, and approve changes in J.P. Morgan Access.",
    brand: "other",
    provider: "de-web",
    tags: ["incidents", "monitoring", "changes"],
    version: "1.7.0",
    app: OPERATIONS_APP,
  }),

  // Payments
  template({
    slug: "corporate-card-controls",
    title: "Corporate card controls",
    description: "Set spending limits and merchant rules for corporate cards, with an approval trail for every change.",
    brand: "payments",
    provider: "community",
    author: "Priya Natarajan",
    tags: ["cards", "limits", "controls"],
    version: "1.3.0",
  }),
  template({
    slug: "payment-status-tracker",
    title: "Payment status tracker",
    description: "Follow every payment from initiation to settlement, with alerts for anything that stalls.",
    brand: "payments",
    provider: "de-web",
    tags: ["tracking", "settlement", "alerts"],
    version: "2.0.0",
  }),
  template({
    slug: "bulk-payments-upload",
    title: "Bulk payments upload",
    description: "Upload payment files, validate them line by line, and release them in batches.",
    brand: "payments",
    provider: "community",
    author: "Marco Bianchi",
    tags: ["files", "validation", "batches"],
    version: "0.9.4",
  }),

  // Global Banking
  template({
    slug: "credit-facility-tracker",
    title: "Credit facility tracker",
    description: "Track facility limits, utilization, and covenants across a client's credit lines.",
    brand: "global-banking",
    provider: "de-web",
    tags: ["credit", "lending", "covenants"],
    version: "1.5.2",
  }),
  template({
    slug: "relationship-notes",
    title: "Relationship notes",
    description: "Capture meeting notes and follow-ups against each client relationship.",
    brand: "global-banking",
    provider: "community",
    author: "Hannah Okafor",
    tags: ["clients", "notes", "follow-ups"],
    version: "1.1.0",
  }),
  template({
    slug: "deal-room",
    title: "Deal room",
    description: "Share documents and track open items with a deal team in one secure space.",
    brand: "global-banking",
    provider: "community",
    author: "Tomás Herrera",
    tags: ["documents", "collaboration", "deals"],
    version: "2.2.0",
  }),

  // Markets
  template({
    slug: "research-hub",
    title: "Research hub",
    description: "Browse and search published research by sector, analyst, and region.",
    brand: "markets",
    provider: "de-web",
    tags: ["research", "publishing", "search"],
    version: "3.0.1",
  }),
  template({
    slug: "fx-rates-board",
    title: "FX rates board",
    description: "A compact board of streaming FX rates with spreads and daily ranges.",
    brand: "markets",
    provider: "community",
    author: "Kenji Watanabe",
    tags: ["fx", "prices", "streaming"],
    version: "1.0.3",
  }),
  template({
    slug: "risk-limits-monitor",
    title: "Risk limits monitor",
    description: "Watch desk risk limits in real time and see breaches as they happen.",
    brand: "markets",
    provider: "de-web",
    tags: ["risk", "limits", "alerts"],
    version: "2.6.0",
  }),

  // Other
  template({
    slug: "team-directory",
    title: "Team directory",
    description: "Find colleagues by team, skill, or location, with an onboarding checklist for new joiners.",
    brand: "other",
    provider: "community",
    author: "Lena Fischer",
    tags: ["people", "search", "onboarding"],
    version: "1.4.0",
  }),
  template({
    slug: "release-calendar",
    title: "Release calendar",
    description: "Plan and publish release windows across teams, with freeze periods built in.",
    brand: "other",
    provider: "de-web",
    tags: ["releases", "planning", "calendar"],
    version: "2.1.0",
  }),
  template({
    slug: "feature-flag-console",
    title: "Feature flag console",
    description: "Roll features out gradually and see which flags are active in each environment.",
    brand: "other",
    provider: "community",
    author: "Ravi Shah",
    tags: ["flags", "configuration", "rollout"],
    version: "1.2.5",
  }),
];

/** The hero templates, whose microfrontends are real Salt that hero generation writes. */
export const HERO_SLUGS: readonly string[] = TEMPLATES.filter((template) => template.hero).map((template) => template.slug);
