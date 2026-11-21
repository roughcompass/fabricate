"use server";

import { notFound, redirect } from "next/navigation";
import { requireApplications } from "@/lib/applications/availability";
import { findApplication, getApplicationRow } from "@/lib/applications/records";
import { findSavedPreview } from "@/lib/applications/saved-previews";
import { getDb } from "@/lib/db/client";
import { NotFoundError, ValidationError } from "@/lib/db/errors";
import { savedPreviewId, setApplicationDefault, setPreviewDefault } from "@/lib/mocks/defaults";
import { DraftExpiredError, cancelDraft, getDraft, saveDraft, updateDraft } from "@/lib/mocks/imports";
import type { HostMapping } from "@/lib/mocks/model";
import { recaptureApplication } from "@/lib/mocks/recapture";
import { StaleMockRuleError, StaleMockSetError, addRulesFromCalls, createRule, createSet, deleteRule, deleteSet, duplicateRule, editRule, editSet, findRule, getSet, moveRule, setRuleEnabled } from "@/lib/mocks/records";
import { type RuleFields, currentBuildId, dismissFailedCalls, failedCallsOf, ruleFields, ruleInputOf } from "@/lib/mocks/views";
import { getConfig } from "@/lib/config";
import { errorsFrom, text, texts } from "@/lib/web/form-data";
import { lockVersion } from "@/lib/web/actions";
import { routes } from "@/lib/web/routes";
import { writableWorkspace } from "@/lib/workspaces/request";
import { createdAddress } from "../../created-address";
import type { DeleteSetFormState, PreviewSetFormState, ReviewFormState, RuleFormState, SetFormState } from "./form-states";

/*
 * The mock sets' Server Actions (add-mock-sets, design decision 18): the
 * application page's row actions and failed-calls alert, the set and rule
 * forms, the rules table's row actions, Review HAR, and a saved preview's
 * choice of set. Each checks that applications are offered, as the pages
 * do, records the visitor's display name as who changed what, and, after a
 * change that could touch a default, captures the builds whose default
 * changed again.
 */

/** The application the address or form names, while it exists, with its row ID. */
function applicationOf(slug: string) {
  requireApplications();
  const application = findApplication(getDb(), slug);
  if (!application) notFound();
  return { ...application, id: getApplicationRow(getDb(), application.publicId).id };
}

/** Who's changing something: the visitor's workspace's display name, if it has one. */
async function byName(): Promise<string | null> {
  return (await writableWorkspace()).displayName;
}

/** Runs +change+, answering not found for a set or rule that no longer exists. */
function found<T>(change: () => T): T {
  try {
    return change();
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}

// -- The application page ------------------------------------------------------------

/** Set as default (mock-sets spec, "An application has an optional default mock set"). */
export async function setDefaultAction(formData: FormData): Promise<void> {
  const application = applicationOf(text(formData, "application", 100));
  const set = text(formData, "set", 40);
  found(() => setApplicationDefault(getDb(), application.id, set));
  recaptureApplication(getDb(), application.id);
  redirect(routes.application(application.slug, { notice: "mock-default-set" }));
}

/** Stop using as default: views no one chose a set for use the application's own network. */
export async function clearDefaultAction(formData: FormData): Promise<void> {
  const application = applicationOf(text(formData, "application", 100));
  setApplicationDefault(getDb(), application.id, null);
  recaptureApplication(getDb(), application.id);
  redirect(routes.application(application.slug, { notice: "mock-default-cleared" }));
}

/** Delete mock set, confirmed in the section's danger confirmation. */
export async function deleteSetAction(formData: FormData): Promise<void> {
  const application = applicationOf(text(formData, "application", 100));
  const deleted = deleteSet(getDb(), application.id, text(formData, "set", 40));
  recaptureApplication(getDb(), application.id);
  redirect(routes.application(application.slug, { notice: deleted ? "mock-set-deleted" : null }));
}

/** Dismiss, on the failed-calls alert: it doesn't show again for this build. */
export async function dismissFailuresAction(formData: FormData): Promise<void> {
  const application = applicationOf(text(formData, "application", 100));
  const failed = failedCallsOf(getDb(), currentBuildId(getDb(), application.id));
  if (failed) dismissFailedCalls(getDb(), failed.screenshotId);
  redirect(routes.application(application.slug));
}

/** Add rules to the set a build was captured with, one for each call that failed and can be mocked, each needing a response. */
export async function addFailedCallsAction(formData: FormData): Promise<void> {
  const application = applicationOf(text(formData, "application", 100));
  const set = text(formData, "set", 40);
  const failed = failedCallsOf(getDb(), currentBuildId(getDb(), application.id));
  const calls = (failed?.calls ?? []).filter((call) => call.kind !== "websocket" && /^(https?:|\/)/.test(call.url));
  const name = await byName();
  try {
    found(() => addRulesFromCalls(getDb(), application.id, set, calls, name));
  } catch (error) {
    // Past the set's limit nothing is added, and the set's page says why.
    if (!(error instanceof ValidationError)) throw error;
    redirect(routes.mockSet(application.slug, set, { notice: "failed-calls-limit" }));
  }
  recaptureApplication(getDb(), application.id);
  redirect(routes.mockSet(application.slug, set, { state: "needs-response", notice: "rules-added" }));
}

// -- Sets ----------------------------------------------------------------------------

function hostsFrom(formData: FormData): HostMapping[] {
  const hosts: HostMapping[] = [];
  for (let index = 0; index < 21; index++) {
    const from = text(formData, `hosts.${index}.from`, 300).trim();
    const to = text(formData, `hosts.${index}.to`, 300).trim();
    if (from || to) hosts.push({ from, to });
  }
  return hosts;
}

function setValues(formData: FormData): SetFormState["values"] {
  return {
    name: text(formData, "name", 200),
    description: text(formData, "description", 2000),
    hostMode: text(formData, "hostMode", 10) === "mapped" ? "mapped" : "any",
    hosts: hostsFrom(formData),
    unmatched: text(formData, "unmatched", 20) === "not_mocked" ? "not_mocked" : "pass",
    calls: texts(formData, "calls", 10, 50),
  };
}

/** New mock set: an empty set, or one with a rule for each chosen failed call, each needing a response. */
export async function createSetAction(slug: string, _previous: SetFormState, formData: FormData): Promise<SetFormState> {
  const application = applicationOf(slug);
  const values = setValues(formData);
  const name = await byName();
  let created: string;
  try {
    const failed = values.calls.length ? failedCallsOf(getDb(), currentBuildId(getDb(), application.id)) : null;
    const calls = (failed?.calls ?? []).filter((call) => values.calls.includes(String(call.position)) && call.kind !== "websocket");
    const set = createSet(getDb(), application.id, { name: values.name, description: values.description, source: calls.length ? "calls" : "written" }, name);
    if (calls.length) addRulesFromCalls(getDb(), application.id, set.publicId, calls, name);
    created = set.publicId;
  } catch (error) {
    if (error instanceof ValidationError) return { values, errors: errorsFrom(error), lockVersion: 0 };
    throw error;
  }
  redirect(routes.mockSet(slug, created, { notice: "set-created" }));
}

/** Edit mock set: its name, description, hosts, and calls no rule matches. */
export async function editSetAction(slug: string, set: string, _previous: SetFormState, formData: FormData): Promise<SetFormState> {
  const application = applicationOf(slug);
  const values = setValues(formData);
  const name = await byName();
  try {
    const input = { name: values.name, description: values.description, hostMode: values.hostMode === "mapped" ? ("mapped" as const) : ("any" as const), hosts: values.hosts, unmatched: values.unmatched === "not_mocked" ? ("not_mocked" as const) : ("pass" as const) };
    found(() => editSet(getDb(), application.id, set, lockVersion(formData), input, name));
  } catch (error) {
    if (error instanceof ValidationError) return { values, errors: errorsFrom(error), lockVersion: Number(formData.get("lockVersion")) };
    if (error instanceof StaleMockSetError) {
      const current = error.current;
      return { values: { name: current.name, description: current.description ?? "", hostMode: current.hostMode, hosts: current.hosts, unmatched: current.unmatched, calls: [] }, errors: { base: [error.message] }, lockVersion: current.lockVersion };
    }
    throw error;
  }
  recaptureApplication(getDb(), application.id);
  redirect(routes.mockSet(slug, set, { notice: "set-updated" }));
}

/** Delete mock set on its edit page, once its name is typed (mock-sets spec, "Deleting a mock set needs a danger confirmation"). */
export async function deleteSetByNameAction(slug: string, setPublicId: string, _previous: DeleteSetFormState, formData: FormData): Promise<DeleteSetFormState> {
  const application = applicationOf(slug);
  const set = found(() => getSet(getDb(), application.id, setPublicId));
  const confirmation = text(formData, "confirmation", 200);
  if (confirmation.trim() !== set.name) return { values: { confirmation }, errors: { confirmation: [`Type ${set.name} to confirm`] } };
  deleteSet(getDb(), application.id, set.publicId);
  recaptureApplication(getDb(), application.id);
  redirect(routes.application(slug, { notice: "mock-set-deleted" }));
}

// -- Rules ---------------------------------------------------------------------------

/** The rule form's fields as it posted them. */
function ruleValues(formData: FormData): RuleFields {
  const count = Math.min(Number(text(formData, "responseCount", 3)) || 0, 21);
  const responses = Array.from({ length: count }, (_, index) => {
    const field = (name: string, max = 4096) => text(formData, `responses.${index}.${name}`, max);
    return { remove: field("remove", 5) === "yes", status: field("status", 5), contentType: field("contentType", 200), headers: field("headers", 60_000), body: field("body", 6 * 1024 * 1024), keep: field("keep", 64), keepSize: Number(field("keepSize", 12)) || 0, latencyMs: field("latencyMs", 6) };
  })
    // A response removed, or one left blank, isn't part of the rule.
    .filter((response) => !response.remove && (response.status.trim() || response.body || response.headers.trim() || response.keep))
    .map(({ remove: _remove, ...response }) => response);
  return {
    method: text(formData, "method", 20),
    pattern: text(formData, "pattern", 2048),
    origin: text(formData, "origin", 300),
    queryMode: text(formData, "queryMode", 20),
    query: text(formData, "query", 60_000),
    queryIgnored: text(formData, "queryIgnored", 4096),
    bodyMode: text(formData, "bodyMode", 10),
    body: text(formData, "body", 70_000),
    enabled: text(formData, "enabled", 5) === "yes",
    responses,
  };
}

/** New rule and Edit rule: saves the rule, or returns the form with its errors, or the newer rule when someone else saved first. */
export async function saveRuleAction(slug: string, set: string, rule: string | null, _previous: RuleFormState, formData: FormData): Promise<RuleFormState> {
  const application = applicationOf(slug);
  const values = ruleValues(formData);
  const version = Number(formData.get("lockVersion")) || 0;
  if (text(formData, "intent", 20) === "add-response") return { values: { ...values, responses: [...values.responses, { status: "200", contentType: "application/json", headers: "", body: "", keep: "", keepSize: 0, latencyMs: "0" }] }, errors: {}, lockVersion: version };
  const name = await byName();
  try {
    const input = ruleInputOf(values);
    found(() => (rule ? editRule(getDb(), application.id, set, rule, lockVersion(formData), input, name) : createRule(getDb(), application.id, set, input, name)));
  } catch (error) {
    if (error instanceof ValidationError) return { values, errors: errorsFrom(error), lockVersion: version };
    if (error instanceof StaleMockRuleError) return { values: ruleFields(getConfig(), { publicId: set }, error.current), errors: { base: [error.message] }, lockVersion: error.current.lockVersion };
    throw error;
  }
  recaptureApplication(getDb(), application.id);
  redirect(routes.mockSet(slug, set, { notice: rule ? "rule-updated" : "rule-created" }));
}

/** Runs a row action on the rule the form names, then opens the page of rules it came from. */
async function onRule(formData: FormData, op: "on" | "off" | "up" | "down" | "duplicate"): Promise<void> {
  const application = applicationOf(text(formData, "application", 100));
  const set = text(formData, "set", 40);
  const rule = text(formData, "rule", 40);
  const name = await byName();
  const back = text(formData, "back", 2048);
  let notice: string | null = null;
  try {
    found(() => {
      if (op === "on" || op === "off") setRuleEnabled(getDb(), application.id, set, rule, op === "on", name);
      else if (op === "up" || op === "down") moveRule(getDb(), application.id, set, rule, op, name);
      else duplicateRule(getDb(), application.id, set, rule, name);
    });
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error;
    notice = op === "on" ? "rule-needs-response" : "rule-limit";
  }
  recaptureApplication(getDb(), application.id);
  const page = back.startsWith(routes.mockSet(application.slug, set)) ? back : routes.mockSet(application.slug, set);
  redirect(notice ? `${page}${page.includes("?") ? "&" : "?"}notice=${notice}` : page);
}

/** A rule's row actions: turn it on or off, move it up or down, or duplicate it. */
export async function ruleOnAction(formData: FormData): Promise<void> {
  await onRule(formData, "on");
}
export async function ruleOffAction(formData: FormData): Promise<void> {
  await onRule(formData, "off");
}
export async function ruleUpAction(formData: FormData): Promise<void> {
  await onRule(formData, "up");
}
export async function ruleDownAction(formData: FormData): Promise<void> {
  await onRule(formData, "down");
}
export async function ruleDuplicateAction(formData: FormData): Promise<void> {
  await onRule(formData, "duplicate");
}

/** Delete rule, confirmed in the danger section of its edit page. */
export async function deleteRuleAction(formData: FormData): Promise<void> {
  const application = applicationOf(text(formData, "application", 100));
  const set = text(formData, "set", 40);
  const rule = text(formData, "rule", 40);
  const name = await byName();
  const existing = found(() => findRule(getDb(), getSet(getDb(), application.id, set), rule));
  if (existing) deleteRule(getDb(), application.id, set, rule, name);
  recaptureApplication(getDb(), application.id);
  redirect(routes.mockSet(application.slug, set, { notice: "rule-deleted" }));
}

// -- Review HAR ----------------------------------------------------------------------

/**
 * Review HAR's submit buttons: a page of calls (saves the checkboxes, then
 * opens that page), Cancel, and Create mock set or Add rules.
 */
export async function reviewAction(slug: string, draftId: string, _previous: ReviewFormState, formData: FormData): Promise<ReviewFormState> {
  const application = applicationOf(slug);
  const workspace = await writableWorkspace();
  let draft;
  try {
    draft = getDraft(getDb(), application.id, workspace.id, draftId);
  } catch (error) {
    if (error instanceof DraftExpiredError) redirect(routes.mockSetImport(slug, draftId));
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  const values: ReviewFormState["values"] = {
    name: text(formData, "name", 200),
    makeDefault: text(formData, "makeDefault", 5) === "yes",
    hostMode: text(formData, "hostMode", 10) === "mapped" ? "mapped" : "any",
    hosts: hostsFrom(formData),
  };
  const intent = text(formData, "intent", 20);
  if (intent === "cancel") {
    cancelDraft(getDb(), draft);
    redirect(draft.fromOnboarding ? routes.applications : routes.application(slug, { notice: "upload-cancelled" }));
  }
  const reviewed = updateDraft(getDb(), draft, {
    shown: texts(formData, "shown", 10, 60),
    checked: texts(formData, "checked", 10, 60),
    ...(!draft.target && { setName: values.name, hosts: { mode: values.hostMode as "any" | "mapped", map: values.hosts } }),
    makeDefault: values.makeDefault,
  });
  if (intent.startsWith("page:")) redirect(routes.mockSetImport(slug, draftId, { page: Number(intent.slice(5)) || 1 }));
  let set;
  try {
    set = saveDraft(getDb(), reviewed, workspace.displayName);
  } catch (error) {
    if (error instanceof ValidationError) return { values, errors: errorsFrom(error) };
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  recaptureApplication(getDb(), application.id);
  if (draft.fromOnboarding) redirect(createdAddress(slug, "created-with-mocks"));
  redirect(routes.mockSet(slug, set.publicId, { notice: draft.target ? "rules-imported" : "set-imported" }));
}

// -- A saved preview's set -------------------------------------------------------------

/** A saved preview's Mock set form: the application's default, None, or a set of its own. */
export async function previewSetAction(slug: string, key: string, _previous: PreviewSetFormState, formData: FormData): Promise<PreviewSetFormState> {
  const application = applicationOf(slug);
  const saved = findSavedPreview(getDb(), application.publicId, key);
  if (!saved) notFound();
  const choice = text(formData, "choice", 40);
  const preview = savedPreviewId(getDb(), saved.publicId);
  try {
    setPreviewDefault(getDb(), application.id, preview, choice === "inherit" ? { kind: "inherit" } : choice === "none" ? { kind: "none" } : { kind: "set", set: choice });
  } catch (error) {
    if (error instanceof NotFoundError) return { values: { choice }, errors: { choice: [error.message] } };
    throw error;
  }
  recaptureApplication(getDb(), application.id);
  redirect(routes.application(slug, { notice: "preview-mock-set", preview: key }));
}
