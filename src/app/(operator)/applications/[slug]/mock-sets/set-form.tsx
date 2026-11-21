"use client";

import { ButtonLink } from "@/components/ui/button";
import { ActionForm, Checkbox, ChoiceGroup, FormAlert, FormFooter, FormSection, HiddenFields, TextArea, TextInput, formStyles } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";
import type { DeleteSetFormState, SetFormState } from "./form-states";
import styles from "./mock-sets.module.css";

/** A call the new set can start from: one that failed when the build was captured. */
export interface StartingCall {
  readonly position: number;
  readonly text: string;
  /** What happened to it, such as "Couldn't connect". */
  readonly failure: string;
  /** A WebSocket, which can't be mocked yet. */
  readonly unsupported: boolean;
}

interface SetFormProps {
  action: (previous: SetFormState, formData: FormData) => Promise<SetFormState>;
  initial: SetFormState;
  /** For New mock set: the calls it can start from, when it was opened from them. */
  calls?: readonly StartingCall[];
  /** For Edit mock set: its hosts and calls no rule matches, which a new set starts without. */
  edit?: boolean;
  submitLabel: string;
  cancelHref: string;
}

/**
 * New mock set and Edit mock set (add-mock-sets, design decision 18): a
 * name and description; for a new set opened from failed calls, the calls to
 * add a rule for, each needing a response; and for an edit, whether the set
 * matches any host or maps the hosts its rules recorded, and what calls no
 * rule matches get. It works without JavaScript.
 */
export function SetForm({ action, initial, calls, edit = false, submitLabel, cancelHref }: SetFormProps) {
  return (
    <ActionForm action={action} initial={initial} alertId="set-form-alert">
      {(state) => {
        const { values, errors } = state;
        return (
          <div className={formStyles.form}>
            <HiddenFields values={{ lockVersion: String(state.lockVersion) }} />
            {(errors.base || errors.hosts) && <FormAlert id="set-form-alert">{[...(errors.base ?? []), ...(errors.hosts ?? [])].join(" ")}</FormAlert>}
            <TextInput id="set-name" name="name" label="Name" required maxLength={60} defaultValue={values.name} errors={errors.name} description="Unique among the application's mock sets, such as Happy path or Errors." />
            <TextArea id="set-description" name="description" label="Description" optional rows={2} maxLength={280} defaultValue={values.description} errors={errors.description} />
            {calls && calls.length > 0 && (
              <FormSection title="Calls to start from" description="A rule is added for each call chosen. Each needs a response written before it answers anything.">
                <ul className={styles.calls}>
                  {calls.map((call) => (
                    <li key={call.position}>
                      <Checkbox
                        id={`set-call-${call.position}`}
                        name="calls"
                        value={String(call.position)}
                        label={<span className={styles.callText}>{call.text}</span>}
                        description={call.unsupported ? `${call.failure}. WebSockets can't be mocked yet.` : call.failure}
                        defaultChecked={!call.unsupported && (values.calls.length === 0 || values.calls.includes(String(call.position)))}
                        disabled={call.unsupported}
                      />
                    </li>
                  ))}
                </ul>
              </FormSection>
            )}
            {edit && (
              <>
                <FormSection title="Hosts" description="Which hosts the set's rules answer. Rules written without a recorded origin answer any host.">
                  <ChoiceGroup
                    id="set-host-mode"
                    name="hostMode"
                    legend="Hosts"
                    type="radio"
                    selected={[values.hostMode]}
                    choices={[
                      { value: "any", label: "Any host", description: "Paths are compared, whatever host the build calls." },
                      { value: "mapped", label: "Map the hosts recorded", description: "Each rule answers only calls to the origin its recorded origin maps to." },
                    ]}
                  />
                  <div className={styles.hosts}>
                    {[...values.hosts, { from: "", to: "" }].map((host, index) => (
                      <div key={index} className={styles.host}>
                        <TextInput id={`set-host-${index}-from`} name={`hosts.${index}.from`} label="Recorded origin" optional mono defaultValue={host.from} errors={errors[`hosts.${index}.from`]} />
                        <TextInput id={`set-host-${index}-to`} name={`hosts.${index}.to`} label="Origin the build calls" optional mono defaultValue={host.to} errors={errors[`hosts.${index}.to`]} description={index === 0 ? "Or self, for the preview's own origin, which relative calls use." : undefined} />
                      </div>
                    ))}
                  </div>
                </FormSection>
                <ChoiceGroup
                  id="set-unmatched"
                  name="unmatched"
                  legend="Calls no rule matches"
                  type="radio"
                  selected={[values.unmatched]}
                  choices={[
                    { value: "pass", label: "Pass through", description: "They go to their own address, as they would without a mock set." },
                    { value: "not_mocked", label: "Answer as not mocked", description: "They get status 501 with X-Frontend-Registry-Mock: not-matched, and nothing is sent." },
                  ]}
                />
              </>
            )}
            <FormFooter>
              <ButtonLink href={cancelHref}>Cancel</ButtonLink>
              <SubmitButton variant="primary" pendingLabel="Saving">
                {submitLabel}
              </SubmitButton>
            </FormFooter>
          </div>
        );
      }}
    </ActionForm>
  );
}

/** Delete mock set on its edit page: it asks for the set's name, since deleting can't be undone. */
export function DeleteSetForm({ action, name }: { action: (previous: DeleteSetFormState, formData: FormData) => Promise<DeleteSetFormState>; name: string }) {
  return (
    <ActionForm action={action} initial={{ values: { confirmation: "" }, errors: {} }}>
      {(state) => (
        <div className={styles.dangerRow}>
          <TextInput id="delete-set-confirmation" name="confirmation" label={`Type ${name} to confirm`} autoComplete="off" defaultValue={state.values.confirmation} errors={state.errors.confirmation} />
          <SubmitButton variant="danger" icon="trash" pendingLabel="Deleting">
            Delete mock set
          </SubmitButton>
        </div>
      )}
    </ActionForm>
  );
}
