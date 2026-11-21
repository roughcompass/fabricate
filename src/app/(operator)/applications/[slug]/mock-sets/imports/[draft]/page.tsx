import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FormTemplate } from "@/components/templates/form-template";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { formatNumber } from "@/components/ui/count";
import { Disclosure } from "@/components/ui/disclosure";
import { getDb } from "@/lib/db/client";
import { NotFoundError } from "@/lib/db/errors";
import { applicationDefault } from "@/lib/mocks/defaults";
import { LEFT_OUT_REASONS } from "@/lib/mocks/har-import";
import { type DraftCall, DraftExpiredError, REVIEW_PAGE_SIZE, draftContents, getDraft } from "@/lib/mocks/imports";
import type { Removed } from "@/lib/mocks/sanitize";
import { param } from "@/lib/web/query";
import { routes } from "@/lib/web/routes";
import { currentWorkspace } from "@/lib/workspaces/request";
import { reviewAction } from "../../actions";
import { type ReviewCall, ReviewForm } from "../../review-form";
import { pageApplication } from "../../shared";
import styles from "../../mock-sets.module.css";

export const metadata: Metadata = { title: "Review HAR" };

const plural = (count: number, noun: string, many = `${noun}s`) => `${formatNumber(count)} ${count === 1 ? noun : many}`;

/** What sanitizing removed, as the summary and each call say it. */
function removedWords(removed: Removed): string[] {
  const headers = Object.entries(removed.headers);
  return [
    ...(headers.length ? [`Headers dropped: ${headers.map(([name, count]) => (count > 1 ? `${name} (${count})` : name)).join(", ")}`] : []),
    ...(removed.cookies ? [`${plural(removed.cookies, "cookie")} dropped`] : []),
    ...(removed.redacted ? [`${plural(removed.redacted, "value")} redacted`] : []),
    ...(removed.tokens ? [`${plural(removed.tokens, "token-like value")} replaced. An application that reads a token's contents needs a synthetic token written into the rule.`] : []),
  ];
}

function reviewCall(call: DraftCall, unchecked: ReadonlySet<string>): ReviewCall {
  const query = call.query.length ? `?${new URLSearchParams(call.query.map(([name, value]) => [name, value])).toString()}` : "";
  return {
    key: call.key,
    origin: call.origin,
    text: `${call.method} ${call.pattern}${query}`,
    responses: call.responses.length === 1 ? `Status ${call.responses[0]!.status}` : `${call.responses.length} responses: ${call.responses.map((response) => response.status).join(", ")}`,
    size: call.size,
    removed: removedWords(call.removed),
    notes: [
      ...(call.queryIgnored.length ? [`Ignores ${call.queryIgnored.join(", ")}`] : []),
      ...(call.bodyMode === "json" ? ["Matches its body as JSON"] : call.bodyMode === "exact" ? ["Matches its body exactly"] : []),
      ...(call.calls > 1 ? [`${formatNumber(call.calls)} calls`] : []),
      ...(call.dropped ? [`Keeps its first ${call.responses.length - 1} responses and its last; ${formatNumber(call.dropped)} more left out`] : []),
    ],
    binary: call.binary,
    checked: !unchecked.has(call.key),
  };
}

/**
 * Review HAR (add-mock-sets, design decisions 12 and 18; mock-set-import
 * spec, "The review shows what is kept, left out, and removed"), on the Form
 * template at the content width: a summary of what was removed, the calls it
 * would keep, by host, 50 to a page, each with a checkbox, its responses, its
 * size, and what was removed from it; what was left out and why; the hosts;
 * and the new set's name and default. Only the workspace that uploaded the
 * file can open it, and it says so once its 24 hours are up.
 */
export default async function ReviewHarPage({ params, searchParams }: PageProps<"/applications/[slug]/mock-sets/imports/[draft]">) {
  const [{ slug, draft: draftId }, query] = await Promise.all([params, searchParams]);
  const application = pageApplication(slug);
  const workspace = await currentWorkspace();
  const header = {
    breadcrumbs: [
      { href: routes.applications, label: "Applications" },
      { href: routes.applicationMockSets(slug), label: application.name },
    ],
    title: "Review HAR",
  };
  let draft;
  try {
    draft = getDraft(getDb(), application.id, workspace?.id ?? null, draftId);
  } catch (error) {
    if (error instanceof DraftExpiredError) {
      return (
        <FormTemplate header={header} empty={{ title: "This upload expired", icon: "clock", children: error.message, action: <ButtonLink href={routes.mockSetUpload(slug)} icon="arrowUp">Upload HAR</ButtonLink> }} />
      );
    }
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  const contents = draftContents(draft);
  const unchecked = new Set(draft.unchecked);
  // Grouped by host, in the order each host was first recorded.
  const origins = [...new Set(contents.calls.map((call) => call.origin))];
  const ordered = [...contents.calls].sort((left, right) => origins.indexOf(left.origin) - origins.indexOf(right.origin));
  const pages = Math.max(1, Math.ceil(ordered.length / REVIEW_PAGE_SIZE));
  const page = Math.min(pages, Math.max(1, Number(param(query, "page")) || 1));
  const shown = ordered.slice((page - 1) * REVIEW_PAGE_SIZE, page * REVIEW_PAGE_SIZE).map((call) => reviewCall(call, unchecked));
  const summary = removedWords(contents.removed);
  const hosts = draft.target ? null : { origins: contents.hosts.origins, reason: contents.hosts.mode === "mapped" ? `This set needs mapped hosts, because ${contents.hosts.origins.length === 2 ? "both origins" : "several origins"} answer ${contents.hosts.conflicts.join(" and ")} differently. Enter the origin the build calls for each.` : null };
  const hasDefault = applicationDefault(getDb(), application.id) !== null;
  const makeDefault = draft.makeDefault ?? !hasDefault;

  return (
    <FormTemplate
      width="content"
      header={{
        ...header,
        description: `${draft.fileName}: ${plural(contents.calls.length, "API call")} to keep${draft.target ? `, added to ${draft.target.name}` : ""}. Nothing is saved until you select ${draft.target ? "Add rules" : "Create mock set"}.`,
      }}
      alerts={
        <Alert tone={summary.length ? "info" : "success"} title={summary.length ? "Credentials were removed before anything was stored" : "No credentials were found"}>
          {summary.length > 0 && (
            <ul className={styles.removed} data-review-summary="">
              {summary.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )}
          <p>{"Personal data can't be detected. Check each call before saving."}</p>
        </Alert>
      }
    >
      <ReviewForm
        action={reviewAction.bind(null, slug, draft.publicId)}
        initial={{ values: { name: draft.setName ?? "", makeDefault, hostMode: draft.hosts?.mode ?? contents.hosts.mode, hosts: draft.hosts?.map ?? [] }, errors: {} }}
        calls={shown}
        page={page}
        pages={pages}
        hosts={hosts}
        target={draft.target ? { kind: "existing", name: draft.target.name } : { kind: "new" }}
        defaultLabel={hasDefault ? "Make it the application's default mock set" : "Make it the application's default mock set, since it has none"}
      />
      {(contents.leftOut.length > 0 || contents.beyondLimit > 0) && (
        <Disclosure summary={`Left out: ${plural(contents.leftOut.length + contents.beyondLimit, "entry", "entries")}`}>
          {contents.beyondLimit > 0 && <p>{`${plural(contents.beyondLimit, "entry", "entries")} past the 5,000th ${contents.beyondLimit === 1 ? "was" : "were"} left out.`}</p>}
          <ul className={styles.leftOut} aria-label="Left out">
            {contents.leftOut.map((item, index) => (
              <li key={index} data-left-out={item.reason}>
                <code>{`${item.method} ${item.url}`}</code>
                {` · ${LEFT_OUT_REASONS[item.reason]}`}
              </li>
            ))}
          </ul>
        </Disclosure>
      )}
    </FormTemplate>
  );
}
