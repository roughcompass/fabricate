import { SHELL_MEMBERS } from "./heroes";
import type { AppDefinition, BrandId } from "./types";

/**
 * The applications of the twelve lighter templates (portal-runtime spec,
 * "Applications are composed of microfrontends"): each its own two Salt
 * microfrontends on one route. The main one owns the route, publishes its
 * selection, and has two versions that differ visibly; the side one sits in
 * the route's Sidebar slot and shows the selected record.
 */

interface LighterApp {
  readonly brand: BrandId;
  readonly owner: string;
  readonly route: { readonly path: string; readonly label: string };
  readonly topic: string;
  readonly main: { readonly id: string; readonly name: string; readonly first: string; readonly second: string };
  readonly side: { readonly id: string; readonly name: string; readonly summary: string };
}

function lighterApp({ brand, owner, route, topic, main, side }: LighterApp): AppDefinition {
  return {
    members: [
      SHELL_MEMBERS[brand],
      {
        id: main.id,
        name: main.name,
        role: "child",
        owner,
        routing: { kind: "route", path: route.path },
        versions: [
          { version: "1.0.0", summary: main.first },
          { version: "1.1.0", summary: main.second },
        ],
        defaultVersion: "1.0.0",
        loadMs: 360,
        swapMs: 380,
        publishes: [topic],
      },
      {
        id: side.id,
        name: side.name,
        role: "child",
        owner,
        routing: { kind: "slot", route: route.path, slot: "Sidebar" },
        versions: [{ version: "1.0.0", summary: side.summary }],
        defaultVersion: "1.0.0",
        loadMs: 300,
        swapMs: 320,
        subscribes: [topic],
      },
    ],
    routes: [
      {
        path: route.path,
        label: route.label,
        owner: main.id,
        regions: [
          { member: main.id, area: "main" },
          { member: side.id, area: "side" },
        ],
      },
    ],
  };
}

export const CARD_CONTROLS_APP = lighterApp({
  brand: "payments",
  owner: "Priya Natarajan",
  route: { path: "cards", label: "Cards" },
  topic: "card:selected",
  main: { id: "card-list", name: "Card list", first: "Cards with their holders, limits, and spend this month", second: "Adds a utilization meter for each card" },
  side: { id: "card-rules", name: "Card rules", summary: "Limits and merchant rules for the selected card, with its approval trail" },
});

export const PAYMENT_TRACKER_APP = lighterApp({
  brand: "payments",
  owner: "DE Web Starter Kits",
  route: { path: "payments", label: "Payments" },
  topic: "payment:selected",
  main: { id: "payment-tracker", name: "Payment tracker", first: "Payments by stage, from initiation to settlement", second: "Adds a stage filter" },
  side: { id: "stall-alerts", name: "Stall alerts", summary: "Where the selected payment is, and what to do if it has stalled" },
});

export const BULK_UPLOAD_APP = lighterApp({
  brand: "payments",
  owner: "Marco Bianchi",
  route: { path: "uploads", label: "Uploads" },
  topic: "file:selected",
  main: { id: "payment-file-upload", name: "Payment file upload", first: "A drop zone and the uploaded files with their validation status", second: "Adds line-level validation results for the selected file" },
  side: { id: "batch-release", name: "Batch release", summary: "The selected file's batches, ready to release" },
});

export const CREDIT_FACILITY_APP = lighterApp({
  brand: "global-banking",
  owner: "DE Web Starter Kits",
  route: { path: "facilities", label: "Facilities" },
  topic: "facility:selected",
  main: { id: "facility-list", name: "Facility list", first: "Facilities with their limit, drawn amount, and utilization", second: "Adds a portfolio utilization summary" },
  side: { id: "covenant-checks", name: "Covenant checks", summary: "The selected facility's covenants and their latest tests" },
});

export const RELATIONSHIP_NOTES_APP = lighterApp({
  brand: "global-banking",
  owner: "Hannah Okafor",
  route: { path: "relationships", label: "Relationships" },
  topic: "relationship:selected",
  main: { id: "relationship-list", name: "Relationship list", first: "Client relationships with their coverage banker and last meeting", second: "Adds each relationship's next follow-up" },
  side: { id: "meeting-notes", name: "Meeting notes", summary: "Notes and follow-ups for the selected client, with a note form" },
});

export const DEAL_ROOM_APP = lighterApp({
  brand: "global-banking",
  owner: "Tomás Herrera",
  route: { path: "documents", label: "Documents" },
  topic: "document:selected",
  main: { id: "deal-documents", name: "Deal documents", first: "Deal documents grouped by folder", second: "Adds each document's version and reviewer" },
  side: { id: "open-items", name: "Open items", summary: "Open items on the selected document" },
});

export const RESEARCH_HUB_APP = lighterApp({
  brand: "markets",
  owner: "DE Web Starter Kits",
  route: { path: "research", label: "Research" },
  topic: "report:selected",
  main: { id: "research-library", name: "Research library", first: "Search and filter published reports", second: "Adds sector tabs" },
  side: { id: "research-reader", name: "Research reader", summary: "The selected report's summary and key points" },
});

export const FX_RATES_APP = lighterApp({
  brand: "markets",
  owner: "Kenji Watanabe",
  route: { path: "rates", label: "Rates" },
  topic: "pair:selected",
  main: { id: "fx-rates", name: "FX rates", first: "Rates by currency pair, with bid, ask, and spread", second: "Adds each pair's daily range" },
  side: { id: "rate-detail", name: "Rate detail", summary: "The selected pair's rates, range, and recent quotes" },
});

export const RISK_LIMITS_APP = lighterApp({
  brand: "markets",
  owner: "DE Web Starter Kits",
  route: { path: "limits", label: "Limits" },
  topic: "desk:selected",
  main: { id: "desk-limits", name: "Desk limits", first: "Desk limits with their usage and headroom", second: "Adds filters for breaches and warnings" },
  side: { id: "limit-breaches", name: "Limit breaches", summary: "Breaches and warnings for the selected desk" },
});

export const TEAM_DIRECTORY_APP = lighterApp({
  brand: "other",
  owner: "Lena Fischer",
  route: { path: "people", label: "People" },
  topic: "person:selected",
  main: { id: "people-search", name: "People search", first: "Search colleagues by name, team, or location", second: "Adds skill filters" },
  side: { id: "joiner-checklist", name: "Joiner checklist", summary: "The selected person's profile and, for a new joiner, their onboarding checklist" },
});

export const RELEASE_CALENDAR_APP = lighterApp({
  brand: "other",
  owner: "DE Web Starter Kits",
  route: { path: "releases", label: "Releases" },
  topic: "release:selected",
  main: { id: "release-windows", name: "Release windows", first: "Release windows by week, with freeze periods marked", second: "Adds a team filter" },
  side: { id: "freeze-periods", name: "Freeze periods", summary: "The selected window's releases and the freezes that affect it" },
});

export const FEATURE_FLAG_APP = lighterApp({
  brand: "other",
  owner: "Ravi Shah",
  route: { path: "flags", label: "Flags" },
  topic: "flag:selected",
  main: { id: "flag-list", name: "Flag list", first: "Flags with their rollout and owner", second: "Adds an environment filter" },
  side: { id: "flag-environments", name: "Flag environments", summary: "The selected flag's state in each environment" },
});
