import type { Metadata } from "next";
import { FormTemplate } from "@/components/templates/form-template";
import { getDb } from "@/lib/db/client";
import { ruleFromCall } from "@/lib/mocks/checks";
import { EMPTY_RESPONSE, type RuleFields, currentBuildId, failedCallsOf } from "@/lib/mocks/views";
import { param } from "@/lib/web/query";
import { routes } from "@/lib/web/routes";
import { saveRuleAction } from "../../../actions";
import { RuleForm } from "../../../rule-form";
import { pageSet } from "../../../shared";

export const metadata: Metadata = { title: "New rule" };

/** A new rule's fields: blank, or from the call that failed at +position+ when the build was captured. */
function fieldsFor(applicationId: number, position: string | undefined): RuleFields {
  const blank: RuleFields = { method: "GET", pattern: "", origin: "", queryMode: "ignore_all", query: "", queryIgnored: "", bodyMode: "ignore", body: "", enabled: true, responses: [EMPTY_RESPONSE] };
  const call = position === undefined ? undefined : failedCallsOf(getDb(), currentBuildId(getDb(), applicationId))?.calls.find((failed) => String(failed.position) === position && /^https?:/.test(failed.url));
  if (!call) return blank;
  const rule = ruleFromCall(call);
  return { ...blank, method: rule.method.toUpperCase(), pattern: rule.pattern, origin: rule.origin ?? "", queryMode: rule.queryMode, query: rule.query.map(([name, value]) => `${name}=${value}`).join("\n") };
}

/**
 * New rule (add-mock-sets, design decision 18), on the Form template: the
 * request and its responses, added at the end of the set, turned on. With
 * `?from=<call>`, it starts from a call that failed when the build was
 * captured: its method, origin, path, and query. It works without
 * JavaScript.
 */
export default async function NewRulePage({ params, searchParams }: PageProps<"/applications/[slug]/mock-sets/[set]/rules/new">) {
  const [{ slug, set: setId }, query] = await Promise.all([params, searchParams]);
  const { application, set } = pageSet(slug, setId);
  return (
    <FormTemplate
      header={{
        breadcrumbs: [
          { href: routes.applications, label: "Applications" },
          { href: routes.applicationMockSets(slug), label: application.name },
          { href: routes.mockSet(slug, set.publicId), label: set.name },
        ],
        title: "New rule",
        description: `A rule answers the calls it matches with its responses. It's added at the end of ${set.name}.`,
      }}
    >
      <RuleForm action={saveRuleAction.bind(null, slug, set.publicId, null)} initial={{ values: fieldsFor(application.id, param(query, "from")), errors: {}, lockVersion: 0 }} submitLabel="Create rule" cancelHref={routes.mockSet(slug, set.publicId)} />
    </FormTemplate>
  );
}
