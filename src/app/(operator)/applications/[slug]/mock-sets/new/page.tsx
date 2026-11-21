import type { Metadata } from "next";
import { FormTemplate } from "@/components/templates/form-template";
import { getDb } from "@/lib/db/client";
import { FAILURE_LABELS, currentBuildId, failedCallsOf } from "@/lib/mocks/views";
import { param } from "@/lib/web/query";
import { routes } from "@/lib/web/routes";
import { createSetAction } from "../actions";
import { SetForm } from "../set-form";
import { pageApplication } from "../shared";

export const metadata: Metadata = { title: "New mock set" };

/**
 * New mock set (add-mock-sets, design decision 18; mock-sets spec, "A mock
 * set can be started from the calls that failed"), on the Form template: a
 * name and description. With `?from=failed-calls`, it lists each distinct
 * call that failed when the current build was captured, and adds a rule for
 * each one chosen, each needing a response. It works without JavaScript.
 */
export default async function NewMockSetPage({ params, searchParams }: PageProps<"/applications/[slug]/mock-sets/new">) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const application = pageApplication(slug);
  const failed = param(query, "from") === "failed-calls" ? failedCallsOf(getDb(), currentBuildId(getDb(), application.id)) : null;
  const calls = failed?.calls.map((call) => ({ position: call.position, text: `${call.method} ${call.url}`, failure: FAILURE_LABELS[call.kind](call.status), unsupported: call.kind === "websocket" || !/^https?:/.test(call.url) }));
  return (
    <FormTemplate
      header={{
        breadcrumbs: [
          { href: routes.applications, label: "Applications" },
          { href: routes.applicationMockSets(slug), label: application.name },
        ],
        title: "New mock set",
        description: calls?.length ? "Start a mock set from the API calls that failed when the current build loaded. Write a response for each rule afterward." : `An empty mock set of ${application.name}. Add rules to it, or upload a HAR file into it.`,
      }}
    >
      <SetForm action={createSetAction.bind(null, slug)} initial={{ values: { name: "", description: "", hostMode: "any", hosts: [], unmatched: "pass", calls: [] }, errors: {}, lockVersion: 0 }} calls={calls} submitLabel="Create mock set" cancelHref={routes.applicationMockSets(slug)} />
    </FormTemplate>
  );
}
