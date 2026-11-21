import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FormTemplate } from "@/components/templates/form-template";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Panel } from "@/components/ui/panel";
import { RelativeTime } from "@/components/ui/relative-time";
import { Section } from "@/components/ui/section";
import { getConfig } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { findRule } from "@/lib/mocks/records";
import { ruleFields, ruleName } from "@/lib/mocks/views";
import { routes } from "@/lib/web/routes";
import { deleteRuleAction, saveRuleAction } from "../../../actions";
import { RuleForm } from "../../../rule-form";
import { pageSet } from "../../../shared";
import styles from "../../../mock-sets.module.css";

export const metadata: Metadata = { title: "Edit rule" };

/**
 * Edit rule (add-mock-sets, design decision 18), on the Form template: the
 * rule's request and responses, saved from the version the page showed, so
 * an edit someone else saved first is refused with their values. Delete rule
 * is in a danger section after the form. It works without JavaScript.
 */
export default async function EditRulePage({ params }: PageProps<"/applications/[slug]/mock-sets/[set]/rules/[rule]">) {
  const { slug, set: setId, rule: ruleId } = await params;
  const { application, set } = pageSet(slug, setId);
  const rule = findRule(getDb(), set, ruleId);
  if (!rule) notFound();
  const name = ruleName(rule);
  return (
    <FormTemplate
      header={{
        breadcrumbs: [
          { href: routes.applications, label: "Applications" },
          { href: routes.applicationMockSets(slug), label: application.name },
          { href: routes.mockSet(slug, set.publicId), label: set.name },
        ],
        title: `Edit ${name}`,
        description: (
          <>
            {`Created${rule.createdByName ? ` by ${rule.createdByName}` : ""} `}
            <RelativeTime value={rule.createdAt} />
            {`, last changed${rule.updatedByName ? ` by ${rule.updatedByName}` : ""} `}
            <RelativeTime value={rule.updatedAt} />.
          </>
        ),
      }}
    >
      <RuleForm action={saveRuleAction.bind(null, slug, set.publicId, rule.publicId)} initial={{ values: ruleFields(getConfig(), set, rule), errors: {}, lockVersion: rule.lockVersion }} submitLabel="Save changes" cancelHref={routes.mockSet(slug, set.publicId)} />
      <Section id="danger-zone" title="Danger zone" description="Deleting a rule can't be undone.">
        <Panel tone="danger">
          <div className={styles.dangerRow}>
            <div>
              <p className={styles.dangerTitle}>Delete rule</p>
              <p className={styles.kept}>{`Removes ${name} from ${set.name} for everyone.`}</p>
            </div>
            <ConfirmDialog action={deleteRuleAction} fields={{ application: slug, set: set.publicId, rule: rule.publicId }} trigger={{ label: "Delete rule", icon: "trash", variant: "secondary" }} title={`Delete ${name}?`} confirmLabel="Delete rule" tone="danger">
              {`${name} is deleted from ${set.name} for everyone who opens the application. Calls it answered pass through, or match another rule.`}
            </ConfirmDialog>
          </div>
        </Panel>
      </Section>
    </FormTemplate>
  );
}
