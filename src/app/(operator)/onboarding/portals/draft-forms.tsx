"use client";

import { type DraftAction, DraftForm, type DraftFormState, value, values } from "@/components/onboarding/draft-form";
import { Button } from "@/components/ui/button";
import { ChoiceGroup, FormNote, FormSection, Select, TextInput } from "@/components/ui/form";
import styles from "@/components/onboarding/onboarding.module.css";

interface StepProps {
  action: DraftAction;
  initial: DraftFormState;
  cancelHref: string;
  /** Issues about the step as a whole, such as no environment chosen. */
  notes?: readonly string[];
}

const errors = (state: DraftFormState, field: string) => state.errors[field];
const rows = (state: DraftFormState, list: string) => values(state, `${list}.rows`).map(Number);

function SaveAndContinue() {
  return (
    <Button type="submit" name="intent" value="continue">
      Save and continue
    </Button>
  );
}

export function IdentityStep({ action, initial, cancelHref, notes, history }: StepProps & { history?: React.ReactNode }) {
  return (
    <DraftForm id="portal-identity" action={action} initial={initial} cancelHref={cancelHref} notes={notes} extraButtons={<SaveAndContinue />}>
      {(state) => (
        <>
          <FormSection title="Identity">
            <TextInput id="ownerTeam" name="ownerTeam" label="Owning team" defaultValue={value(state, "ownerTeam")} errors={errors(state, "ownerTeam")} maxLength={200} description="The team that owns this Portal's configuration and reviews the placements in it." required />
            <TextInput id="sealId" name="sealId" label="SEAL ID" mono optional defaultValue={value(state, "sealId")} errors={errors(state, "sealId")} maxLength={64} description="Metadata: other Portals may carry the same one, and changing it keeps this Portal and its routes." />
          </FormSection>
          {history}
        </>
      )}
    </DraftForm>
  );
}

/** An environment the catalog lists, as the step offers it. */
export interface CatalogChoice {
  key: string;
  label: string;
}

/** Where the catalog came from, as the step shows it. */
export interface CatalogProvenance {
  source: "studio" | "fallback";
  /** When Studio returned the list, for Studio's. */
  observed: string | null;
  stale: boolean;
  note: string | null;
}

/**
 * The environments the Portal enables, chosen from the environment catalog:
 * Studio's list when Studio has returned one, or the fallback set. An
 * environment here has no runtime or entitlements; each placement names the
 * environments it appears in, and its entitlements are reviewed with it.
 */
export function EnvironmentsStep({ action, initial, cancelHref, notes, catalog, provenance }: StepProps & { catalog: readonly CatalogChoice[]; provenance: CatalogProvenance }) {
  return (
    <DraftForm id="portal-environments" action={action} initial={initial} cancelHref={cancelHref} notes={notes} extraButtons={<SaveAndContinue />}>
      {(state) => {
        const selected = values(state, "environments");
        // A key saved before the catalog changed stays visible, so it can be unchecked.
        const unlisted = selected.filter((key) => !catalog.some((environment) => environment.key === key));
        return (
          <>
            <FormNote title={provenance.source === "studio" ? `From Studio, read ${provenance.observed}` : "The fallback environment set"} icon={provenance.stale ? "alert" : provenance.source === "studio" ? "checkCircle" : "info"}>
              <p>{provenance.source === "studio" ? "These are the environments Studio lists. Nobody edits them here." : "Studio's environment list isn't available, so DEV, UAT, TEST, and PROD are offered. Nobody edits them here."}</p>
              {provenance.note && <p>{`${provenance.note}.`}</p>}
            </FormNote>
            <FormSection title="Enabled environments">
              <ChoiceGroup
                id="environments"
                name="environments"
                legend="The Portal enables"
                type="checkbox"
                columns
                selected={selected}
                errors={errors(state, "environments")}
                description="Placements in this Portal choose from these. Entitlements are set on each placement, where you review them."
                choices={[...catalog.map((environment) => ({ value: environment.key, label: environment.label })), ...unlisted.map((key) => ({ value: key, label: key.toUpperCase(), description: "Not in the catalog any more" }))]}
              />
            </FormSection>
          </>
        );
      }}
    </DraftForm>
  );
}

export function MenuStep({ action, initial, cancelHref, notes }: StepProps) {
  return (
    <DraftForm id="portal-menu" action={action} initial={initial} cancelHref={cancelHref} notes={notes} extraButtons={<SaveAndContinue />}>
      {(state) => {
        const indices = rows(state, "menu");
        // A group can sit inside any other group, by that group's key; the list never offers the group itself.
        const othersOf = (index: number) => [...new Set(indices.filter((other) => other !== index).map((other) => value(state, `menu.${other}.key`)).filter(Boolean))];
        return (
          <>
            <p>Menu groups are containers, such as Payments or Payments › Tools. Applications are placed under them by approved placements, which have the routes.</p>
            {indices.map((index, position) => {
              const at = `menu.${index}`;
              const id = `menu-${position}`;
              return (
                <FormSection key={index} title={value(state, `${at}.label`) || `Group ${position + 1}`}>
                  <input type="hidden" name="menu.rows" value={index} />
                  <div id={position === indices.length - 1 ? "last-row" : undefined} className={styles.row}>
                    <TextInput id={`${id}-label`} name={`${at}.label`} label="Label" defaultValue={value(state, `${at}.label`)} errors={errors(state, `${id}-label`)} maxLength={100} required />
                    <TextInput id={`${id}-key`} name={`${at}.key`} label="Key" mono defaultValue={value(state, `${at}.key`)} errors={errors(state, `${id}-key`)} description="Lowercase, such as payments." maxLength={64} required />
                    <Select id={`${id}-parent`} name={`${at}.parent`} label="Inside" defaultValue={value(state, `${at}.parent`)} errors={errors(state, `${id}-parent`)} options={[{ value: "", label: "Top level" }, ...othersOf(index).map((key) => ({ value: key, label: key }))]} />
                    <TextInput id={`${id}-order`} name={`${at}.order`} label="Position" inputMode="numeric" defaultValue={value(state, `${at}.order`)} errors={errors(state, `${id}-order`)} maxLength={6} />
                  </div>
                  <div className={styles.rowActions}>
                    <Button type="submit" name="intent" value={`remove:menu:${position}`} variant="tertiary" size="sm" icon="trash">
                      {`Remove ${value(state, `${at}.label`) || "group"}`}
                    </Button>
                  </div>
                </FormSection>
              );
            })}
            <div className={styles.rowActions}>
              <Button type="submit" name="intent" value="add:menu" icon="plus">
                Add menu group
              </Button>
            </div>
          </>
        );
      }}
    </DraftForm>
  );
}
