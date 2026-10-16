import { describe, expect, it } from "vitest";
import { TEMPLATES } from "@/lib/demo/catalog";
import { EMPTY_QUERY, type GalleryTemplate, filterTemplates, galleryHref, galleryOrder, isFiltered, optionCounts, parseGalleryQuery, searchScore, searchWords } from "@/lib/demo/gallery";

const slugs = (templates: { slug: string }[]) => templates.map((template) => template.slug);

describe("gallery query", () => {
  it("reads the search and known filters from the URL, ignoring unknown values", () => {
    expect(parseGalleryQuery({ q: "  On   boarding ", brand: ["markets", "nope", "payments"], provider: "community" })).toEqual({
      search: "On boarding",
      brands: ["payments", "markets"],
      providers: ["community"],
      origins: [],
    });
    expect(parseGalleryQuery({})).toEqual(EMPTY_QUERY);
    expect(parseGalleryQuery({ q: "x".repeat(500) }).search).toHaveLength(100);
  });

  it("lists every template with no query, heroes first and then by title", () => {
    const all = filterTemplates(EMPTY_QUERY);
    expect(all).toHaveLength(TEMPLATES.length);
    expect(all.slice(0, 4).every((template) => template.hero)).toBe(true);
    expect(slugs(all.slice(0, 4))).toEqual(["client-onboarding", "market-watch", "operations-console", "payments-workspace"]);
    const rest = all.slice(4).map((template) => template.title);
    expect(rest).toEqual([...rest].sort((left, right) => left.localeCompare(right, "en")));
    expect(slugs(galleryOrder([...TEMPLATES].reverse()))).toEqual(slugs(all));
  });

  it("searches title, description, tags, and author, ignoring case", () => {
    expect(slugs(filterTemplates({ ...EMPTY_QUERY, search: "onboarding" }))).toEqual(["client-onboarding", "team-directory"]);
    expect(slugs(filterTemplates({ ...EMPTY_QUERY, search: "WATCHLIST" }))).toEqual(["market-watch"]);
    expect(slugs(filterTemplates({ ...EMPTY_QUERY, search: "streaming" }))).toEqual(["fx-rates-board"]);
    expect(slugs(filterTemplates({ ...EMPTY_QUERY, search: "kenji" }))).toEqual(["fx-rates-board"]);
  });

  it("combines options within a group with OR, and groups and the search with AND", () => {
    const result = filterTemplates({ search: "", brands: ["payments", "markets"], providers: ["de-web"], origins: [] });
    expect(result.every((template) => ["payments", "markets"].includes(template.brand) && template.provider === "de-web")).toBe(true);
    expect(slugs(result)).toEqual(["market-watch", "payments-workspace", "payment-status-tracker", "research-hub", "risk-limits-monitor"]);
    expect(slugs(filterTemplates({ search: "limits", brands: ["markets"], providers: [], origins: [] }))).toEqual(["risk-limits-monitor"]);
  });

  it("matches a description by its words, ignoring filler, and ranks templates matching more of them first", () => {
    expect(searchWords("A dashboard for approving the PAYMENTS, today!")).toEqual(["dashboard", "approving", "payments", "today"]);
    const result = filterTemplates({ ...EMPTY_QUERY, search: "payments status tracker" });
    expect(slugs(result)[0]).toBe("payment-status-tracker");
    expect(result.every((template) => searchScore(template, "payments status tracker") > 0)).toBe(true);
    expect(searchScore(result[0]!, "payments status tracker")).toBeGreaterThan(searchScore(result.at(-1)!, "payments status tracker"));
    // A search of filler only still matches as one phrase.
    expect(filterTemplates({ ...EMPTY_QUERY, search: "the" }).length).toBeGreaterThan(0);
  });

  it("returns nothing when nothing matches", () => {
    expect(filterTemplates({ ...EMPTY_QUERY, search: "quantum teleporter" })).toEqual([]);
    expect(filterTemplates({ search: "kyc", brands: ["markets"], providers: [], origins: [] })).toEqual([]);
  });

  it("counts what each option would match, applying the search and the other group", () => {
    const counts = optionCounts(EMPTY_QUERY);
    expect(Object.values(counts.brand).reduce((sum, count) => sum + count, 0)).toBe(TEMPLATES.length);
    expect(counts.brand.payments).toBe(4);
    expect(counts.provider["de-web"] + counts.provider.community).toBe(TEMPLATES.length);

    // Choosing a brand does not shrink the other brands' counts, but it does narrow the providers.
    const markets = optionCounts({ search: "", brands: ["markets"], providers: [], origins: [] });
    expect(markets.brand).toEqual(counts.brand);
    expect(markets.provider).toEqual({ "de-web": 3, community: 1 });

    const searched = optionCounts({ search: "onboarding", brands: [], providers: [], origins: [] });
    expect(searched.brand).toEqual({ payments: 0, "global-banking": 1, markets: 0, other: 1 });
  });

  it("builds the gallery URL for a query and knows when it is filtered", () => {
    expect(galleryHref(EMPTY_QUERY)).toBe("/templates");
    expect(galleryHref({ search: "kyc checks", brands: ["payments", "markets"], providers: ["de-web"], origins: [] })).toBe("/templates?q=kyc+checks&brand=payments&brand=markets&provider=de-web");
    expect(isFiltered(EMPTY_QUERY)).toBe(false);
    expect(isFiltered({ ...EMPTY_QUERY, providers: ["community"] })).toBe(true);
    expect(parseGalleryQuery(Object.fromEntries(new URLSearchParams("q=a&brand=other").entries()))).toMatchObject({ search: "a", brands: ["other"] });
  });

  it("files templates accepted from prototypes under Community and the From Prototypes origin, and searches who accepted them (From Prototypes origin; Community includes accepted templates)", () => {
    const accepted: GalleryTemplate = { slug: "urgent-payments-queue-a1b2c3", title: "Urgent payments queue", description: "Payments that need action lead.", brand: "payments", provider: "community", origin: "prototypes", acceptedBy: "Maya's team", templateVersion: 2, tags: ["Payments"], hero: false, preview: { src: "/api/prototypes/templates/ptp_aaaaaaaaaaaaaaaa/preview", alt: "" } };
    const all = [...TEMPLATES, accepted];
    const query = parseGalleryQuery({ origin: "prototypes" });
    expect(query.origins).toEqual(["prototypes"]);
    expect(filterTemplates(query, all).map((template) => template.slug)).toEqual([accepted.slug]);
    expect(optionCounts(EMPTY_QUERY, all).origin).toEqual({ "built-in": TEMPLATES.length, prototypes: 1 });
    const community = filterTemplates(parseGalleryQuery({ provider: "community" }), all);
    expect(community.map((template) => template.slug)).toContain(accepted.slug);
    expect(community.length).toBe(TEMPLATES.filter((template) => template.provider === "community").length + 1);
    expect(galleryHref({ ...EMPTY_QUERY, origins: ["prototypes"] })).toBe("/templates?origin=prototypes");
    expect(isFiltered({ ...EMPTY_QUERY, origins: ["built-in"] })).toBe(true);
    expect(filterTemplates({ ...EMPTY_QUERY, search: "maya's" }, all).map((template) => template.slug)).toEqual([accepted.slug]);
    // Not a hero, so it follows the heroes, by title.
    expect(filterTemplates(EMPTY_QUERY, all).findIndex((template) => template.slug === accepted.slug)).toBeGreaterThanOrEqual(4);
  });
});
