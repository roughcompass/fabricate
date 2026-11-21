import type { Metadata } from "next";
import { FormTemplate } from "@/components/templates/form-template";
import { Panel } from "@/components/ui/panel";
import { Section } from "@/components/ui/section";
import { getDb } from "@/lib/db/client";
import { applicationDefaultSetId } from "@/lib/mocks/defaults";
import { routes } from "@/lib/web/routes";
import { deleteSetByNameAction, editSetAction } from "../../actions";
import { DeleteSetForm, SetForm } from "../../set-form";
import { pageSet } from "../../shared";
import styles from "../../mock-sets.module.css";

export const metadata: Metadata = { title: "Edit mock set" };

/**
 * Edit mock set (add-mock-sets, design decision 18), on the Form template:
 * its name, description, hosts, and calls no rule matches, saved from the
 * version the page showed. Delete mock set is in a danger section after the
 * form, and asks for the set's name, since deleting can't be undone. It
 * works without JavaScript.
 */
export default async function EditMockSetPage({ params }: PageProps<"/applications/[slug]/mock-sets/[set]/edit">) {
  const { slug, set: setId } = await params;
  const { application, set } = pageSet(slug, setId);
  const isDefault = applicationDefaultSetId(getDb(), application.id) === set.id;
  return (
    <FormTemplate
      header={{
        breadcrumbs: [
          { href: routes.applications, label: "Applications" },
          { href: routes.applicationMockSets(slug), label: application.name },
          { href: routes.mockSet(slug, set.publicId), label: set.name },
        ],
        title: `Edit ${set.name}`,
      }}
    >
      <SetForm
        action={editSetAction.bind(null, slug, set.publicId)}
        initial={{ values: { name: set.name, description: set.description ?? "", hostMode: set.hostMode, hosts: set.hosts, unmatched: set.unmatched, calls: [] }, errors: {}, lockVersion: set.lockVersion }}
        edit
        submitLabel="Save changes"
        cancelHref={routes.mockSet(slug, set.publicId)}
      />
      <Section id="danger-zone" title="Danger zone" description="Deleting a mock set can't be undone.">
        <Panel tone="danger">
          <p className={styles.dangerTitle}>Delete mock set</p>
          <p className={styles.kept}>
            {`Deletes ${set.name} and its rules for everyone who opens the application. Views that chose it apply their default set again.`}
            {isDefault && " It's the application's default, so the application will have no default set."}
          </p>
          <DeleteSetForm action={deleteSetByNameAction.bind(null, slug, set.publicId)} name={set.name} />
        </Panel>
      </Section>
    </FormTemplate>
  );
}
