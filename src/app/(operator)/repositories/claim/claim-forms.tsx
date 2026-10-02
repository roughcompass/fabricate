"use client";

import { useActionState } from "react";
import { ButtonLink } from "@/components/ui/button";
import { type Choice, ChoiceGroup, FormAlert, FormFooter, FormNote, FormSection, Select, TextInput, formStyles } from "@/components/ui/form";
import { Panel } from "@/components/ui/panel";
import { SubmitButton } from "@/components/ui/submit-button";
import { useFocusFirstInvalid } from "@/components/ui/use-focus-first-invalid";
import type { ClaimAction, ClaimFormState } from "./form-state";

export interface Option {
  value: string;
  label: string;
}

interface FormShellProps {
  action: ClaimAction;
  initial: ClaimFormState;
  id: string;
  cancelHref: string;
  cancelLabel?: string;
  submitLabel: string;
  children: (state: ClaimFormState) => React.ReactNode;
}

/** One Panel whose footer holds Cancel and the primary action, as every form does. */
function ClaimForm({ action, initial, id, cancelHref, cancelLabel = "Cancel", submitLabel, children }: FormShellProps) {
  const [state, formAction] = useActionState(action, initial);
  const form = useFocusFirstInvalid(state, `${id}-alert`);
  return (
    <form ref={form} action={formAction} noValidate data-claim-form={id}>
      <Panel
        footer={
          <FormFooter>
            <ButtonLink href={cancelHref}>{cancelLabel}</ButtonLink>
            <SubmitButton pendingLabel="Saving">{submitLabel}</SubmitButton>
          </FormFooter>
        }
      >
        <div className={formStyles.form}>
          {state.errors.base && <FormAlert id={`${id}-alert`}>{state.errors.base.join(" ")}</FormAlert>}
          {children(state)}
        </div>
      </Panel>
    </form>
  );
}

const value = (state: ClaimFormState, field: string) => {
  const entry = state.values[field];
  return typeof entry === "string" ? entry : "";
};
const values = (state: ClaimFormState, field: string) => {
  const entry = state.values[field];
  return Array.isArray(entry) ? entry : [];
};

export function UrlForm({ action }: { action: ClaimAction }) {
  return (
    <ClaimForm action={action} initial={{ values: { cloneUrl: "" }, errors: {} }} id="claim-url" cancelHref="/repositories" submitLabel="Continue">
      {(state) => (
        <TextInput
          id="claim-clone-url"
          name="cloneUrl"
          label="Git URL"
          mono
          inputMode="url"
          defaultValue={value(state, "cloneUrl")}
          errors={state.errors.cloneUrl}
          description="The https:// or ssh:// URL you clone it from. Leave credentials out."
          required
        />
      )}
    </ClaimForm>
  );
}

export function SealForm({ action, listed, cancelHref }: { action: ClaimAction; listed: readonly Option[]; cancelHref: string }) {
  return (
    <ClaimForm action={action} initial={{ values: {}, errors: {} }} id="claim-seal" cancelHref={cancelHref} submitLabel="Continue">
      {(state) => (
        <>
          {listed.length > 0 && (
            <Select
              id="claim-seal-id"
              name="sealId"
              label="SEAL ID"
              defaultValue={value(state, "sealId")}
              errors={state.errors.sealId}
              description="The DE Console's SEAL applications. Choose one to take its team and portals from the DE Console."
              options={[{ value: "", label: "Choose a SEAL application" }, ...listed]}
            />
          )}
          <TextInput
            id="claim-seal-id-other"
            name={listed.length > 0 ? "sealIdOther" : "sealId"}
            label={listed.length > 0 ? "Another SEAL ID" : "SEAL ID"}
            optional={listed.length > 0}
            mono
            defaultValue={value(state, listed.length > 0 ? "sealIdOther" : "sealId")}
            errors={listed.length > 0 ? state.errors.sealIdOther : state.errors.sealId}
            description={listed.length > 0 ? "For an application the DE Console doesn't list." : "The SEAL application this Repository belongs to."}
            maxLength={64}
            required={listed.length === 0}
          />
        </>
      )}
    </ClaimForm>
  );
}

export interface QuestionsProps {
  action: ClaimAction;
  sealId: string;
  asks: { team: boolean; lineOfBusiness: boolean; portals: boolean };
  portals: readonly Choice[];
  linesOfBusiness: readonly Option[];
  claimant: string;
  launchToken: string;
  cancelHref: string;
}

/** Asks only what's unknown, then who's answering, and optionally which portal the Repository hosts. */
export function QuestionsForm({ action, sealId, asks, portals, linesOfBusiness, claimant, launchToken, cancelHref }: QuestionsProps) {
  const asking = asks.team || asks.lineOfBusiness || asks.portals;
  return (
    <ClaimForm action={action} initial={{ values: { providedBy: claimant }, errors: {} }} id="claim-questions" cancelHref={cancelHref} submitLabel="Claim Repository">
      {(state) => (
        <>
          <input type="hidden" name="sealId" value={sealId} />
          <input type="hidden" name="launchToken" value={launchToken} />
          {state.errors.sealId && <FormAlert id="claim-questions-seal">{state.errors.sealId.join(" ")}</FormAlert>}
          {asking ? (
            <FormSection title="SEAL application" description={`What isn't known yet about ${sealId}.`}>
              {asks.team && <TextInput id="claim-team" name="team" label="Team" defaultValue={value(state, "team")} errors={state.errors.team} description="The team that owns this application." maxLength={200} required />}
              {asks.lineOfBusiness && <LineOfBusinessFields state={state} choices={linesOfBusiness} />}
              {asks.portals && <PortalFields state={state} choices={portals} />}
            </FormSection>
          ) : (
            <FormNote title="Nothing else to ask">Everything else about {sealId} is known. Claiming links this Repository to it.</FormNote>
          )}
          <FormSection title="Portal host" description="Only if this Repository is the host, or shell, that loads a portal's applications.">
            <ListedOrOther state={state} field="hosts" label="Portal this Repository hosts" otherLabel="Another portal" choices={portals.map((choice) => ({ value: choice.value, label: choice.label }))} empty="None" optional />
          </FormSection>
          <ClaimantFields state={state} />
        </>
      )}
    </ClaimForm>
  );
}

export function OwnerForm({ action, claimant, cancelHref }: { action: ClaimAction; claimant: string; cancelHref: string }) {
  return (
    <ClaimForm action={action} initial={{ values: { providedBy: claimant }, errors: {} }} id="claim-owner" cancelHref={cancelHref} cancelLabel="Not now" submitLabel="Confirm owner">
      {(state) => <ClaimantFields state={state} />}
    </ClaimForm>
  );
}

export interface CorrectionProps {
  action: ClaimAction;
  initial: ClaimFormState;
  /** The DE Console's team, which isn't corrected here. */
  consoleTeam: string | null;
  /** True when the DE Console's portals are the application's portals. */
  consolePortals: boolean;
  portals: readonly Choice[];
  linesOfBusiness: readonly Option[];
  cancelHref: string;
}

export function CorrectionForm({ action, initial, consoleTeam, consolePortals, portals, linesOfBusiness, cancelHref }: CorrectionProps) {
  return (
    <ClaimForm action={action} initial={initial} id="claim-correction" cancelHref={cancelHref} submitLabel="Save changes">
      {(state) => (
        <>
          <FormSection title="SEAL application" description="A new SEAL ID is saved on its own. You're then asked for anything not known about that application.">
            <TextInput id="correct-seal-id" name="sealId" label="SEAL ID" mono defaultValue={value(state, "sealId")} errors={state.errors.sealId} maxLength={64} required />
            {consoleTeam === null ? (
              <TextInput id="correct-team" name="team" label="Team" defaultValue={value(state, "team")} errors={state.errors.team} maxLength={200} required />
            ) : (
              <FormNote title={`Team: ${consoleTeam}`}>The DE Console is the record of this team. Correct it there.</FormNote>
            )}
            <LineOfBusinessFields state={state} choices={linesOfBusiness} />
            {consolePortals ? <FormNote title="Portals">The DE Console is the record of this application&apos;s portals. Correct them there.</FormNote> : <PortalFields state={state} choices={portals} />}
          </FormSection>
          <ClaimantFields state={state} />
        </>
      )}
    </ClaimForm>
  );
}

function LineOfBusinessFields({ state, choices }: { state: ClaimFormState; choices: readonly Option[] }) {
  return <ListedOrOther state={state} field="lineOfBusiness" label="Line of Business" otherLabel="Another Line of Business" choices={choices} empty="Choose a Line of Business" />;
}

function PortalFields({ state, choices }: { state: ClaimFormState; choices: readonly Choice[] }) {
  return (
    <>
      {choices.length > 0 && <ChoiceGroup id="claim-portals" name="portals" legend="Portals" type="checkbox" choices={choices} selected={values(state, "portals")} errors={state.errors.portals} description="Every portal this application appears in." columns />}
      <TextInput
        id="claim-portals-other"
        name="portalsOther"
        label={choices.length > 0 ? "Other portals" : "Portals"}
        optional={choices.length > 0}
        defaultValue={value(state, "portalsOther")}
        errors={choices.length > 0 ? undefined : state.errors.portals}
        description="Separate several with commas. A new portal waits for review before others are offered it."
      />
    </>
  );
}

/** A Select of approved values with a text field for any other, which waits for review. */
function ListedOrOther({ state, field, label, otherLabel, choices, empty, optional = false }: { state: ClaimFormState; field: string; label: string; otherLabel: string; choices: readonly Option[]; empty: string; optional?: boolean }) {
  const other = `${field}Other`;
  if (choices.length === 0) {
    return <TextInput id={`claim-${field}`} name={other} label={label} optional={optional} defaultValue={value(state, other)} errors={[...(state.errors[field] ?? []), ...(state.errors[other] ?? [])]} description="New values wait for review before others are offered them." maxLength={100} required={!optional} />;
  }
  return (
    <>
      <Select id={`claim-${field}`} name={field} label={label} optional={optional} defaultValue={value(state, field)} errors={state.errors[field]} options={[{ value: "", label: empty }, ...choices]} />
      <TextInput id={`claim-${field}-other`} name={other} label={otherLabel} optional defaultValue={value(state, other)} errors={state.errors[other]} description="If it isn't listed. New values wait for review before others are offered them." maxLength={100} />
    </>
  );
}

function ClaimantFields({ state }: { state: ClaimFormState }) {
  return (
    <FormSection title="You" description="Recorded with each value you enter. Values aren't verified until you can sign in with Bitbucket.">
      <TextInput id="claim-provided-by" name="providedBy" label="Your name or email" defaultValue={value(state, "providedBy")} errors={state.errors.providedBy} autoComplete="email" maxLength={200} required />
      <TextInput id="claim-attributed-to" name="attributedTo" label="Entering this for someone else? Their name or email" optional defaultValue={value(state, "attributedTo")} errors={state.errors.attributedTo} maxLength={200} />
    </FormSection>
  );
}
