import { and, eq } from "drizzle-orm";
import type { Db } from "../../src/lib/db/client";
import { immediate } from "../../src/lib/db/client";
import { type FailedCallKind, type MockHostMode, type MockQueryMode, type MockUnmatched, applicationPreviews, applications, previewScreenshots, screenshotFailedCalls } from "../../src/lib/db/schema";
import { setApplicationDefault, setPreviewDefault } from "../../src/lib/mocks/defaults";
import { checkRule } from "../../src/lib/mocks/checks";
import type { HostMapping, MockSet, RuleInput } from "../../src/lib/mocks/model";
import { appendRules, createSet, getSet } from "../../src/lib/mocks/records";
import { withOverrides } from "../../src/lib/config";
import { insertRepository } from "../../src/lib/repositories/repository-records";
import { onboard } from "../../test/support/applications";
import { serverConfig } from "./results";

/*
 * Mock sets for browser tests (add-mock-sets, task 2.7), for both agents'
 * specs: a set seeded with rules as the records store them, a default for
 * an application or a saved preview, and the calls a capture recorded as
 * failed. Bodies go to the e2e server's preview storage, as the server's own
 * writes do.
 */

export interface SeedResponse {
  readonly status?: number;
  /** A body written as JSON, with `application/json`. */
  readonly json?: unknown;
  /** A body written as text, with `contentType` or `text/plain`. */
  readonly text?: string;
  readonly contentType?: string;
  readonly headers?: readonly [string, string][];
  readonly latencyMs?: number;
}

export interface SeedRule {
  /** GET by default; `*` for any. */
  readonly method?: string;
  readonly pattern: string;
  readonly origin?: string | null;
  readonly query?: { readonly mode: MockQueryMode; readonly params?: readonly [string, string][]; readonly ignored?: readonly string[] };
  readonly body?: { readonly mode: "exact"; readonly text: string } | { readonly mode: "json"; readonly value: unknown };
  /** None makes a rule that needs a response, turned off. */
  readonly responses?: readonly SeedResponse[];
  readonly enabled?: boolean;
}

export interface SeedSetOptions {
  readonly name?: string;
  readonly description?: string;
  readonly hostMode?: MockHostMode;
  readonly hosts?: readonly HostMapping[];
  readonly unmatched?: MockUnmatched;
  /** The display name recorded as who made it. */
  readonly byName?: string | null;
  /** Makes it the application's default. */
  readonly default?: boolean;
}

const encoder = new TextEncoder();

function ruleInput(rule: SeedRule): RuleInput {
  const body = rule.body ? { bytes: encoder.encode(rule.body.mode === "json" ? JSON.stringify(rule.body.value) : rule.body.text), type: rule.body.mode === "json" ? "application/json" : "text/plain" } : null;
  return {
    method: rule.method ?? "GET",
    origin: rule.origin ?? null,
    pattern: rule.pattern,
    queryMode: rule.query?.mode ?? "ignore_all",
    query: rule.query?.params ?? [],
    queryIgnored: rule.query?.ignored ?? [],
    bodyMode: rule.body?.mode ?? "ignore",
    body,
    enabled: rule.enabled,
    responses: (rule.responses ?? []).map((response) => ({
      status: response.status ?? 200,
      headers: response.headers ?? [],
      contentType: response.contentType ?? (response.json !== undefined ? "application/json" : response.text !== undefined ? "text/plain" : null),
      body: response.json !== undefined ? encoder.encode(JSON.stringify(response.json)) : response.text !== undefined ? encoder.encode(response.text) : null,
      latencyMs: response.latencyMs ?? 0,
    })),
  };
}

function applicationId(db: Db, slug: string): number {
  const row = db.select({ id: applications.id }).from(applications).where(eq(applications.slug, slug)).get();
  if (!row) throw new Error(`No application ${slug}`);
  return row.id;
}

function previewId(db: Db, application: number, key: string): number {
  const row = db
    .select({ id: applicationPreviews.id })
    .from(applicationPreviews)
    .where(and(eq(applicationPreviews.applicationId, application), eq(applicationPreviews.key, key)))
    .get();
  if (!row) throw new Error(`No saved preview ${key}`);
  return row.id;
}

/** Creates the set +options.name+ ("Happy path" by default) of the application +slug+ with +rules+, in order, and returns it as stored. */
export function seedMockSet(db: Db, slug: string, rules: readonly SeedRule[], options: SeedSetOptions = {}): MockSet {
  const application = applicationId(db, slug);
  const config = serverConfig();
  const created = createSet(db, application, { name: options.name ?? "Happy path", description: options.description ?? null, hostMode: options.hostMode, hosts: options.hosts, unmatched: options.unmatched }, options.byName ?? null);
  const checked = rules.map((rule) => checkRule(ruleInput(rule)));
  const set = checked.length ? immediate(db, (tx) => appendRules(tx, getSet(tx, application, created.publicId), checked, options.byName ?? null, config).set) : created;
  if (options.default) setApplicationDefault(db, application, set.publicId);
  return set;
}

/**
 * Makes +set+ the default of the application +slug+, or clears it for null.
 * With +options.preview+, sets that saved preview's own default instead: the
 * set, None for null, or the application's again with +options.inherit+.
 */
export function setDefault(db: Db, slug: string, set: string | null, options: { preview?: string; inherit?: boolean } = {}): void {
  const application = applicationId(db, slug);
  if (options.preview === undefined) {
    setApplicationDefault(db, application, set);
    return;
  }
  const preview = previewId(db, application, options.preview);
  setPreviewDefault(db, application, preview, options.inherit ? { kind: "inherit" } : set === null ? { kind: "none" } : { kind: "set", set });
}

export interface SeedFailedCall {
  readonly method?: string;
  readonly url: string;
  readonly kind: FailedCallKind;
  /** For `status` and `not_mocked`. */
  readonly status?: number;
  readonly error?: string;
  readonly occurrences?: number;
}

/** The row ID of the application +slug+, for the records' functions. */
export function mockApplicationId(db: Db, slug: string): number {
  return applicationId(db, slug);
}

/**
 * Records +calls+ as the API calls that failed when the current build of the
 * application +slug+, or of its saved preview +options.preview+, was
 * captured, replacing any recorded before, with the set it was captured
 * with, if any. +options.total+ counts calls beyond those kept.
 */
export function seedFailedCalls(db: Db, slug: string, calls: readonly SeedFailedCall[], options: { preview?: string; set?: Pick<MockSet, "publicId" | "name" | "revision"> | null; total?: number } = {}): void {
  const application = applicationId(db, slug);
  const current =
    options.preview === undefined
      ? db.select({ id: applications.currentPreviewId }).from(applications).where(eq(applications.id, application)).get()?.id
      : db.select({ id: applicationPreviews.currentPreviewId }).from(applicationPreviews).where(eq(applicationPreviews.id, previewId(db, application, options.preview))).get()?.id;
  if (!current) throw new Error(`${slug} has no current build`);
  const screenshot = db.select().from(previewScreenshots).where(eq(previewScreenshots.previewId, current)).get();
  if (!screenshot) throw new Error(`${slug}'s current build has no screenshot`);
  immediate(db, (tx) => {
    tx.delete(screenshotFailedCalls).where(eq(screenshotFailedCalls.screenshotId, screenshot.id)).run();
    calls.slice(0, 50).forEach((call, position) => {
      tx.insert(screenshotFailedCalls)
        .values({ screenshotId: screenshot.id, position, method: call.method ?? "GET", url: call.url, kind: call.kind, status: call.status ?? null, error: call.error ?? null, occurrences: call.occurrences ?? 1 })
        .run();
    });
    tx.update(previewScreenshots)
      .set({ failedCalls: options.total ?? calls.length, failuresDismissedAt: null, mockSetPublicId: options.set?.publicId ?? null, mockSetName: options.set?.name ?? null, mockSetRevision: options.set?.revision ?? null })
      .where(eq(previewScreenshots.id, screenshot.id))
      .run();
  });
}

const ORDERS = [
  { id: "1001", account: "Northwind Traders", status: "open", total: 1280 },
  { id: "1002", account: "Contoso Pharmaceuticals", status: "open", total: 640 },
  { id: "1003", account: "Fabrikam Logistics", status: "closed", total: 2210 },
  { id: "1004", account: "Northwind Traders", status: "closed", total: 395 },
  { id: "1005", account: "Fabrikam Logistics", status: "open", total: 1730 },
];

/**
 * Orders portal's "Happy path", as importing `orders-portal.chrome.har`
 * keeps it, apart from the rules the build never calls: recent orders, an
 * account, both searches, an export that's ready on the third poll, and the
 * live orders stream. It has no rule for `GET /v1/rates`.
 */
export const ORDERS_HAPPY_PATH: readonly SeedRule[] = [
  { pattern: "/v1/orders", origin: "https://dev-api.orders.test", query: { mode: "ignore_listed", params: [["limit", "5"]], ignored: ["_"] }, responses: [{ json: { orders: ORDERS } }] },
  { pattern: "/v1/accounts/:id", responses: [{ json: { id: "42", name: "Northwind Traders", region: "North America", orders: ORDERS.filter((order) => order.id === "1001" || order.id === "1004").map(({ id, status, total }) => ({ id, status, total })) } }] },
  { method: "POST", pattern: "/v1/orders/search", body: { mode: "json", value: { status: "open" } }, responses: [{ json: { status: "open", orders: ORDERS.filter((order) => order.status === "open") } }] },
  { method: "POST", pattern: "/v1/orders/search", body: { mode: "json", value: { status: "closed" } }, responses: [{ json: { status: "closed", orders: ORDERS.filter((order) => order.status === "closed") } }] },
  { method: "POST", pattern: "/v1/exports", responses: [{ status: 202, json: { id: "9", status: "pending" } }] },
  { pattern: "/v1/exports/9", responses: [{ json: { id: "9", status: "pending" } }, { json: { id: "9", status: "pending" } }, { json: { id: "9", status: "ready", file: "/v1/exports/9/file" } }] },
  {
    pattern: "/v1/orders/stream",
    responses: [
      {
        contentType: "text/event-stream",
        text: [
          { id: "1006", account: "Contoso Pharmaceuticals", status: "open", total: 410 },
          { id: "1007", account: "Northwind Traders", status: "open", total: 2890 },
          { id: "1008", account: "Fabrikam Logistics", status: "open", total: 120 },
        ]
          .map((order) => `data: ${JSON.stringify(order)}\n\n`)
          .join(""),
      },
    ],
  },
];

/**
 * An application named +name+ as onboarding creates it, without building
 * it, for pages that need no build: its first build stays queued, since the
 * browser tests' server runs no worker.
 */
export function unbuiltApplication(db: Db, name = "Orders portal"): { slug: string; id: number } {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const repository = insertRepository(db, { name: slug, cloneUrl: `https://git.example.com/acme/${slug}.git`, canonicalUrl: `https://git.example.com/acme/${slug}`, gitRef: null });
  const created = onboard(db, withOverrides(serverConfig(), { previews: { enabled: true } }), repository, { name });
  return { slug: created.slug, id: created.id };
}
