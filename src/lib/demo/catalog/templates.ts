import { BRANDS } from "./brands";
import { BULK_UPLOAD_APP, CARD_CONTROLS_APP, CREDIT_FACILITY_APP, DEAL_ROOM_APP, FEATURE_FLAG_APP, FX_RATES_APP, PAYMENT_TRACKER_APP, RELATIONSHIP_NOTES_APP, RELEASE_CALENDAR_APP, RESEARCH_HUB_APP, RISK_LIMITS_APP, TEAM_DIRECTORY_APP } from "./apps";
import { GLOBAL_BANKING_APP, MARKETS_APP, OPERATIONS_APP, PAYMENTS_APP } from "./heroes";
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
  app: AppDefinition;
  /** One of the four full hero templates. */
  hero?: boolean;
}

function template(input: TemplateInput): Template {
  return {
    ...input,
    origin: "built-in",
    hero: input.hero === true,
    preview: {
      // Captured from the reference deployment by scripts/capture-template-previews.mjs.
      src: `/demo/previews/${input.slug}.jpg`,
      alt: `Preview of the ${input.title} template in the ${BRANDS[input.brand].portalName} portal`,
    },
  };
}

/**
 * Every template in the gallery: one hero per brand, built to tell the full
 * toolbar story, and twelve lighter templates, each its own Salt
 * application, so the gallery feels like a marketplace.
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
    hero: true,
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
    hero: true,
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
    hero: true,
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
    hero: true,
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
    app: CARD_CONTROLS_APP,
  }),
  template({
    slug: "payment-status-tracker",
    title: "Payment status tracker",
    description: "Follow every payment from initiation to settlement, with alerts for anything that stalls.",
    brand: "payments",
    provider: "de-web",
    tags: ["tracking", "settlement", "alerts"],
    version: "2.0.0",
    app: PAYMENT_TRACKER_APP,
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
    app: BULK_UPLOAD_APP,
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
    app: CREDIT_FACILITY_APP,
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
    app: RELATIONSHIP_NOTES_APP,
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
    app: DEAL_ROOM_APP,
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
    app: RESEARCH_HUB_APP,
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
    app: FX_RATES_APP,
  }),
  template({
    slug: "risk-limits-monitor",
    title: "Risk limits monitor",
    description: "Watch desk risk limits in real time and see breaches as they happen.",
    brand: "markets",
    provider: "de-web",
    tags: ["risk", "limits", "alerts"],
    version: "2.6.0",
    app: RISK_LIMITS_APP,
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
    app: TEAM_DIRECTORY_APP,
  }),
  template({
    slug: "release-calendar",
    title: "Release calendar",
    description: "Plan and publish release windows across teams, with freeze periods built in.",
    brand: "other",
    provider: "de-web",
    tags: ["releases", "planning", "calendar"],
    version: "2.1.0",
    app: RELEASE_CALENDAR_APP,
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
    app: FEATURE_FLAG_APP,
  }),
];

/** The four full hero templates, one per brand. Every built-in template's microfrontends are committed Salt source. */
export const HERO_SLUGS: readonly string[] = TEMPLATES.filter((template) => template.hero).map((template) => template.slug);
