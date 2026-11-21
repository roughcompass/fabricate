"use client";

import { formatBytes, formatNumber } from "@/components/ui/count";
import { ActionForm, Checkbox, ChoiceGroup, FormAlert, FormFooter, FormSection, HiddenFields, TextInput, formStyles } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";
import type { ReviewFormState } from "./form-states";
import styles from "./mock-sets.module.css";

/** A call the review lists: one rule the draft would save. */
export interface ReviewCall {
  readonly key: string;
  readonly origin: string;
  /** Its method and address, such as `GET /v1/orders?limit=5`. */
  readonly text: string;
  /** Its responses' statuses in brief, such as "200, 200, 202". */
  readonly responses: string;
  readonly size: number;
  /** What was removed from it, in words, one item a line. */
  readonly removed: readonly string[];
  /** A note on its matching, such as "Ignores _" or "Compared as JSON". */
  readonly notes: readonly string[];
  readonly binary: boolean;
  readonly checked: boolean;
}

interface ReviewFormProps {
  action: (previous: ReviewFormState, formData: FormData) => Promise<ReviewFormState>;
  initial: ReviewFormState;
  /** The page's calls, grouped by host. */
  calls: readonly ReviewCall[];
  page: number;
  pages: number;
  /** A new set's hosts to map, each recorded origin with its calls, and why mapped hosts are suggested. */
  hosts: { readonly origins: readonly { readonly origin: string; readonly calls: number }[]; readonly reason: string | null } | null;
  /** The new set's name and default box, or the existing set's name. */
  target: { readonly kind: "new" } | { readonly kind: "existing"; readonly name: string };
  defaultLabel: string;
}

/**
 * Review HAR's form (add-mock-sets, design decision 12, steps 9 and 10):
 * the page's calls with their checkboxes, then the hosts and the name and
 * default box for a new set. Moving between pages saves the checkboxes, so
 * it works without JavaScript; Cancel deletes the draft.
 */
export function ReviewForm({ action, initial, calls, page, pages, hosts, target, defaultLabel }: ReviewFormProps) {
  const listed = calls.map((call, index) => ({ ...call, heading: index === 0 || calls[index - 1]!.origin !== call.origin }));
  return (
    <ActionForm action={action} initial={initial} alertId="review-form-alert">
      {(state) => (
        <div className={formStyles.form}>
          <HiddenFields values={{ shown: calls.map((call) => call.key) }} />
          {/* Enter in a field saves the review, as its first submit button does. */}
          <button type="submit" name="intent" value="save" className="visually-hidden" tabIndex={-1} aria-hidden="true">
            Save
          </button>
          {state.errors.base && <FormAlert id="review-form-alert">{state.errors.base.join(" ")}</FormAlert>}
          <FormSection title="Calls to keep" description="Each kept call becomes a rule. Unchecked calls aren't saved.">
            <ul className={styles.calls}>
              {listed.map((call) => {
                return (
                  <li key={call.key} data-review-call={call.text}>
                    {call.heading && <p className={styles.responseTitle}>{call.origin}</p>}
                    <Checkbox
                      id={`review-${call.key}`}
                      name="checked"
                      value={call.key}
                      defaultChecked={call.checked}
                      label={<span className={styles.callText}>{call.text}</span>}
                      description={[`${call.responses} · ${formatBytes(call.size)}`, ...call.notes, ...(call.binary ? ["Its body can't be checked for credentials or personal data."] : [])].join(" · ")}
                    />
                    {call.removed.length > 0 && (
                      <ul className={styles.removed} aria-label={`Removed from ${call.text}`}>
                        {call.removed.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
            {pages > 1 && (
              <nav aria-label="Pages of calls" className={styles.toolbar}>
                <p className={styles.count}>{`Page ${formatNumber(page)} of ${formatNumber(pages)}`}</p>
                <span>
                  {page > 1 && (
                    <SubmitButton name="intent" value={`page:${page - 1}`} variant="secondary" size="sm" pendingLabel="Saving">
                      Previous page
                    </SubmitButton>
                  )}{" "}
                  {page < pages && (
                    <SubmitButton name="intent" value={`page:${page + 1}`} variant="secondary" size="sm" pendingLabel="Saving">
                      Next page
                    </SubmitButton>
                  )}
                </span>
              </nav>
            )}
          </FormSection>
          {hosts && (
            <FormSection title="Hosts" description="The origins the kept calls were recorded on.">
              {hosts.reason && <p>{hosts.reason}</p>}
              <ChoiceGroup
                id="review-host-mode"
                name="hostMode"
                legend="The new set matches"
                type="radio"
                selected={[state.values.hostMode]}
                choices={[
                  { value: "any", label: "Any host", description: "Paths are compared, whatever host the build calls." },
                  { value: "mapped", label: "The hosts below", description: "Each recorded origin answers calls to the origin the build calls instead." },
                ]}
              />
              <div className={styles.hosts}>
                {hosts.origins.map(({ origin: recorded, calls: count }, index) => (
                  <div key={recorded} className={styles.host}>
                    <HiddenFields values={{ [`hosts.${index}.from`]: recorded }} />
                    <TextInput
                      id={`review-host-${index}`}
                      name={`hosts.${index}.to`}
                      label={`The build calls, for ${recorded}`}
                      mono
                      defaultValue={state.values.hosts.find((host) => host.from === recorded)?.to ?? recorded}
                      errors={state.errors[`hosts.${index}.to`]}
                      description={`${formatNumber(count)} ${count === 1 ? "call" : "calls"} recorded. Enter an origin, or self for the preview's own origin.`}
                    />
                  </div>
                ))}
              </div>
            </FormSection>
          )}
          <FormSection title="Name and default">
            {target.kind === "new" ? (
              <TextInput id="review-name" name="name" label="Mock set's name" required maxLength={60} defaultValue={state.values.name} errors={state.errors.name} />
            ) : (
              <p>{`The kept calls are added after the rules of ${target.name}.`}</p>
            )}
            <Checkbox id="review-default" name="makeDefault" value="yes" label={defaultLabel} defaultChecked={state.values.makeDefault} description="The default applies to views no one chose a set for, and to screenshots." />
          </FormSection>
          <FormFooter>
            <SubmitButton name="intent" value="cancel" variant="secondary" pendingLabel="Cancelling">
              Cancel
            </SubmitButton>
            <SubmitButton name="intent" value="save" variant="primary" pendingLabel="Saving">
              {target.kind === "new" ? "Create mock set" : "Add rules"}
            </SubmitButton>
          </FormFooter>
        </div>
      )}
    </ActionForm>
  );
}
