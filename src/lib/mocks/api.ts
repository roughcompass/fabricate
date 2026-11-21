import { applicationsUnavailable } from "@/lib/applications/availability";
import { getDb } from "@/lib/db/client";
import { NotFoundError, StaleRecordError } from "@/lib/db/errors";
import { isPublicId } from "@/lib/db/ids";
import { type ViewedApplication, viewedApplication } from "@/lib/workspaces/access";
import { notFound } from "@/lib/workspaces/api";
import type { MockRule, MockSet } from "./model";
import { StaleMockRuleError, StaleMockSetError, findSet } from "./records";

/*
 * Shared plumbing for the mock sets' route handlers (add-mock-sets, task
 * 4): each answers not found while previews are off, for an unknown
 * application, and for a set of another application. Reads need nothing
 * more, as reading the application's presets doesn't; changes add the
 * presets route's same-origin and workspace checks. Every answer is
 * `Cache-Control: no-store`, so a deleted set never lingers in a cache.
 */

export const NO_STORE = { "Cache-Control": "no-store" } as const;

/** The application +slug+ names, or a response that refuses it. */
export function mockApplication(slug: string): ViewedApplication | Response {
  const unavailable = applicationsUnavailable();
  if (unavailable) return unavailable;
  return viewedApplication(getDb(), slug) ?? notFound();
}

/** The application and its set the address names, or a response that refuses them. */
export function mockSetOf(slug: string, setPublicId: string): { application: ViewedApplication; set: MockSet } | Response {
  const application = mockApplication(slug);
  if (application instanceof Response) return application;
  const set = isPublicId(setPublicId, "mks") ? findSet(getDb(), application.id, setPublicId) : undefined;
  return set ? { application, set } : notFound();
}

/** A set as an endpoint answers with it, dates as ISO strings. */
export function shownSet(set: MockSet) {
  const { id: _id, applicationId: _applicationId, ...shown } = set;
  return { ...shown, createdAt: set.createdAt.toISOString(), updatedAt: set.updatedAt.toISOString() };
}

/** A rule as an endpoint answers with it, dates as ISO strings. */
export function shownRule(rule: MockRule) {
  const { id: _id, setId: _setId, ...shown } = rule;
  return { ...shown, needsResponse: rule.responses.length === 0, createdAt: rule.createdAt.toISOString(), updatedAt: rule.updatedAt.toISOString() };
}

/**
 * A stale edit as 409, with the record as it stands, or a deleted one as 404; anything else is thrown again.
 * @public The mock sets' change endpoints use this (add-mock-sets, task 4.2).
 */
export function refusedChange(error: unknown): Response {
  if (error instanceof StaleMockRuleError) return Response.json({ errors: { base: [error.message] }, rule: shownRule(error.current) }, { status: 409, headers: NO_STORE });
  if (error instanceof StaleMockSetError) return Response.json({ errors: { base: [error.message] }, set: shownSet(error.current) }, { status: 409, headers: NO_STORE });
  if (error instanceof StaleRecordError) return Response.json({ errors: { base: [error.message] } }, { status: 409, headers: NO_STORE });
  if (error instanceof NotFoundError) return Response.json({ errors: { base: [error.message] } }, { status: 404, headers: NO_STORE });
  throw error;
}
