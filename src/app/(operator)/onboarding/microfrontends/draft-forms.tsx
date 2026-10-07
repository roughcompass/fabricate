"use client";

import { type DraftAction, DraftForm, type DraftFormState, value } from "@/components/onboarding/draft-form";
import { Button, ButtonLink } from "@/components/ui/button";
import { Checkbox, FormNote, FormSection, Select, TextArea, TextInput } from "@/components/ui/form";
import styles from "@/components/onboarding/onboarding.module.css";

interface StepProps {
  action: DraftAction;
  initial: DraftFormState;
  cancelHref: string;
  notes?: readonly string[];
}

const errors = (state: DraftFormState, field: string) => state.errors[field];

function SaveAndContinue() {
  return (
    <Button type="submit" name="intent" value="continue">
      Save and continue
    </Button>
  );
}

export function IdentityStep({ action, initial, cancelHref, notes, history }: StepProps & { history?: React.ReactNode }) {
  return (
    <DraftForm id="mfe-identity" action={action} initial={initial} cancelHref={cancelHref} notes={notes} extraButtons={<SaveAndContinue />}>
      {(state) => (
        <>
          <FormSection title="Name and owner">
            <TextInput id="name" name="name" label="Name" defaultValue={value(state, "name")} errors={errors(state, "name")} maxLength={200} required />
            <TextInput id="ownerTeam" name="ownerTeam" label="Owning team" defaultValue={value(state, "ownerTeam")} errors={errors(state, "ownerTeam")} maxLength={200} description="The team that changes this MFE. Other teams' Applications can still use it." required />
            <TextInput id="sealId" name="sealId" label="SEAL ID" mono optional defaultValue={value(state, "sealId")} errors={errors(state, "sealId")} maxLength={64} description="Metadata: other MFEs may carry the same one." />
          </FormSection>
          {history}
        </>
      )}
    </DraftForm>
  );
}

export interface RepositoryOption {
  value: string;
  label: string;
}

/**
 * Where the MFE is built from: one catalog Repository, and the workspace
 * inside it for a monorepo. A Repository that's missing or disabled says
 * where to fix it.
 */
export function SourceStep({ action, initial, cancelHref, notes, repositories, search, chosen }: StepProps & { repositories: readonly RepositoryOption[]; search: string; chosen: { name: string; enabled: boolean; href: string } | null }) {
  return (
    <DraftForm id="mfe-source" action={action} initial={initial} cancelHref={cancelHref} notes={notes} extraButtons={<SaveAndContinue />}>
      {(state) => (
        <FormSection title="Built from">
          {repositories.length === 0 ? (
            <FormNote title={search ? `No enabled Repository matches “${search}”` : "No enabled Repositories yet"} icon="git">
              Add the Repository this MFE is built from to the catalog, then come back.{" "}
              <ButtonLink href="/repositories/new" size="sm" icon="plus">
                New Repository
              </ButtonLink>
            </FormNote>
          ) : (
            <Select id="repository" name="repository" label="Repository" defaultValue={value(state, "repository")} errors={errors(state, "repository")} description={search ? `Enabled Repositories matching “${search}”.` : "Enabled Repositories in the catalog. Search to narrow the list."} options={[{ value: "", label: "Choose a Repository" }, ...repositories]} />
          )}
          {chosen && !chosen.enabled && (
            // The field's error says what's wrong; this is where to fix it.
            <div className={styles.rowActions}>
              <ButtonLink href={chosen.href} size="sm">
                {`Find ${chosen.name} in Repositories`}
              </ButtonLink>
            </div>
          )}
          <TextInput id="workspacePath" name="workspacePath" label="Workspace path" mono optional defaultValue={value(state, "workspacePath")} errors={errors(state, "workspacePath")} description="For a monorepo: the directory that builds this MFE, relative to the Repository root, such as apps/search. Leave it empty for the root." maxLength={200} />
        </FormSection>
      )}
    </DraftForm>
  );
}

export function CdaasStep({ action, initial, cancelHref, notes, confirmation }: StepProps & { confirmation: React.ReactNode }) {
  return (
    <DraftForm id="mfe-cdaas" action={action} initial={initial} cancelHref={cancelHref} notes={notes} extraButtons={<SaveAndContinue />}>
      {(state) => (
        <>
          <FormSection title="CDaaS application view">
            <TextInput id="cdaas-appId" name="cdaas.appId" label="appId" mono optional defaultValue={value(state, "cdaas.appId")} errors={errors(state, "cdaas-appId")} description="The existing CDaaS application's ID. It's never taken from a SEAL ID or Studio." maxLength={128} />
            <TextInput id="cdaas-viewId" name="cdaas.viewId" label="viewId" mono optional defaultValue={value(state, "cdaas.viewId")} errors={errors(state, "cdaas-viewId")} description="The view of that application that represents this MFE." maxLength={128} />
          </FormSection>
          {confirmation}
        </>
      )}
    </DraftForm>
  );
}

/**
 * How each rendering mode loads the MFE: framed as a document, imported as
 * an ESM module, or loaded by a Module Federation 2 host. An Application's
 * launch or child binding picks one module from these; nothing here asks
 * what the MFE needs from a host or offers its children.
 */
export function RenderingStep({ action, initial, cancelHref, notes }: StepProps) {
  return (
    <DraftForm id="mfe-rendering" action={action} initial={initial} cancelHref={cancelHref} notes={notes} extraButtons={<SaveAndContinue />}>
      {(state) => (
        <>
          <FormSection title="iframe">
            <Checkbox id="rendering-iframe" name="rendering.iframe.enabled" label="A Portal can frame it" defaultChecked={value(state, "rendering.iframe.enabled") === "on"} />
            <TextInput id="rendering-iframe-entry" name="rendering.iframe.entry" label="Document" mono optional defaultValue={value(state, "rendering.iframe.entry")} errors={errors(state, "rendering-iframe-entry")} description="The page to frame, relative to the CDaaS view, such as index.html. Leave it empty to frame the view's root." maxLength={200} />
          </FormSection>
          <FormSection title="ESM module">
            <Checkbox id="rendering-esm" name="rendering.esm.enabled" label="It can be imported as an ESM module" defaultChecked={value(state, "rendering.esm.enabled") === "on"} />
            <TextArea id="rendering-esm-exports" name="rendering.esm.exports" label="Exported modules" optional rows={2} defaultValue={value(state, "rendering.esm.exports")} errors={errors(state, "rendering-esm-exports")} description="The exports an Application can mount, one per line, such as ./Search." />
          </FormSection>
          <FormSection title="Module Federation 2">
            <Checkbox id="rendering-module_federation_2" name="rendering.module_federation_2.enabled" label="A Module Federation 2 host can load it" defaultChecked={value(state, "rendering.module_federation_2.enabled") === "on"} />
            <TextArea id="rendering-module_federation_2-exposes" name="rendering.module_federation_2.exposes" label="Exposed modules" optional rows={2} defaultValue={value(state, "rendering.module_federation_2.exposes")} errors={errors(state, "rendering-module_federation_2-exposes")} description="The modules its remote exposes, one per line, such as ./App." />
          </FormSection>
        </>
      )}
    </DraftForm>
  );
}
