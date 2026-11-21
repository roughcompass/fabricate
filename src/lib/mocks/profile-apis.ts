import type { JsonObject } from "@repo-facts/contract";
import { eq } from "drizzle-orm";
import type { Executor } from "@/lib/db/client";
import { applications, previewPreparations } from "@/lib/db/schema";
import { profileDocument, profileOfSurvey } from "@/lib/profiles/profile-records";

/*
 * What a Profile says about an application's data (add-mock-sets, design
 * decision 19): the APIs its code calls, from its Service Dependencies, and
 * the test substitutes it has, such as MSW handlers. Onboarding's Data step
 * lists them. Nothing here generates a mock: the Profile's evidence is
 * incomplete, so it only says what was found.
 */

/** How many services the Data step lists, and how many operations of each. */
export const SERVICES_SHOWN = 10;
export const OPERATIONS_SHOWN = 5;

export interface ProfileService {
  /** Where it's called: an origin such as `https://api.orders.test`, a configured key, or the same origin. */
  readonly endpoint: string;
  readonly client: string;
  /** Its operations, such as `GET /v1/orders`, up to five. */
  readonly operations: readonly string[];
  /** How many more operations it has. */
  readonly more: number;
}

export interface ProfileApis {
  readonly services: readonly ProfileService[];
  /** How many more services there are than those listed. */
  readonly moreServices: number;
  /** The test substitutes found, such as "MSW handlers in `src/mocks/handlers.ts`". */
  readonly substitutes: readonly string[];
}

const CLIENTS: Record<string, string> = { fetch: "fetch", axios: "axios", event_source: "EventSource", websocket: "WebSocket", graphql: "GraphQL", generated: "A generated client", packaged: "A packaged client" };

const isObject = (value: unknown): value is JsonObject => typeof value === "object" && value !== null && !Array.isArray(value);

function endpointText(service: JsonObject): string {
  const endpoint = isObject(service.endpoint) ? service.endpoint : {};
  const value = isObject(endpoint.value) ? endpoint.value : {};
  if (typeof value.origin === "string") return value.origin;
  if (value.derivation === "configured" && typeof value.key === "string") return `${String(value.source ?? "configuration")}.${value.key}`;
  if (value.derivation === "relative") return "The application's own origin";
  return "An address the code works out as it runs";
}

function operationsOf(service: JsonObject): string[] {
  const operations = isObject(service.operations) ? service.operations.value : null;
  const list = Array.isArray(operations) ? operations : isObject(operations) && Array.isArray(operations.known) ? operations.known : [];
  return list.filter(isObject).map((operation) => {
    const path = String(operation.path ?? operation.operation ?? "").replace(/\{param\}/g, ":param");
    if (typeof operation.method === "string") return `${operation.method} ${path}`;
    if (operation.kind === "stream") return `Event stream ${path}`;
    if (operation.kind === "connect") return `WebSocket ${path}`;
    return path;
  });
}

/** A test substitute fact in words, by the file its evidence names. */
function substituteText(fact: JsonObject, evidence: JsonObject): string | null {
  const value = isObject(fact.value) ? fact.value : {};
  const record = Array.isArray(fact.evidence) && typeof fact.evidence[0] === "string" ? evidence[fact.evidence[0]] : undefined;
  const file = isObject(record) && typeof record.path === "string" ? record.path : typeof value.path === "string" ? value.path : null;
  const library = typeof value.library === "string" ? value.library : null;
  const where = file ? ` in \`${file}\`` : "";
  if (value.kind === "fixture_directory") return `Fixtures in \`${String(value.path ?? file ?? "")}\``;
  if (value.kind === "request_interceptor") return library === "msw" ? `MSW handlers${where}` : `${library ?? "Request"} interceptors${where}`;
  if (value.kind === "mock_server") return library?.startsWith("msw") ? `An MSW worker${where}` : `A mock server${where}`;
  return library ? `${library} mocks${where}` : file ? `Test substitutes${where}` : null;
}

/** The APIs and test substitutes the Profile the survey +surveyId+ wrote reports, or nothing when it has none. */
export function profileApis(db: Executor, surveyId: number | null): ProfileApis {
  const none: ProfileApis = { services: [], moreServices: 0, substitutes: [] };
  if (surveyId === null) return none;
  const profile = profileOfSurvey(db, surveyId);
  const document = profile ? profileDocument(profile).fact_document : null;
  if (!isObject(document)) return none;
  const services = (Array.isArray(document.service_dependencies) ? document.service_dependencies : []).filter(isObject).map((service): ProfileService => {
    const operations = operationsOf(service);
    const client = isObject(service.client) && typeof service.client.kind === "string" ? (CLIENTS[service.client.kind] ?? service.client.kind) : "Unknown client";
    return { endpoint: endpointText(service), client, operations: operations.slice(0, OPERATIONS_SHOWN), more: Math.max(0, operations.length - OPERATIONS_SHOWN) };
  });
  const categories = isObject(document.categories) ? document.categories : {};
  const category = isObject(categories.test_substitutes) ? categories.test_substitutes : {};
  const evidence = isObject(document.evidence) ? document.evidence : {};
  const substitutes = [...new Set((Array.isArray(category.facts) ? category.facts : []).filter(isObject).map((fact) => substituteText(fact, evidence)).filter((text): text is string => text !== null))];
  return { services: services.slice(0, SERVICES_SHOWN), moreServices: Math.max(0, services.length - SERVICES_SHOWN), substitutes };
}

/** Whether onboarding offers its Data step: the Profile reports a Service Dependency or a test substitute. */
export function offersDataStep(apis: ProfileApis): boolean {
  return apis.services.length > 0 || apis.substitutes.length > 0;
}

/** What the Profile of the commit an application's latest build checked reports, as onboarding's Data step lists it. */
export function applicationApis(db: Executor, applicationPublicId: string): ProfileApis {
  const row = db
    .select({ survey: previewPreparations.surveyId })
    .from(applications)
    .innerJoin(previewPreparations, eq(previewPreparations.id, applications.latestPreparationId))
    .where(eq(applications.publicId, applicationPublicId))
    .get();
  return profileApis(db, row?.survey ?? null);
}
