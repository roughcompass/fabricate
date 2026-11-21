"use client";

import { ButtonLink } from "@/components/ui/button";
import { formatBytes } from "@/components/ui/count";
import { ActionForm, Checkbox, ChoiceGroup, FormAlert, FormFooter, FormSection, HiddenFields, Select, TextArea, TextInput, formStyles } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";
import type { ResponseFields } from "@/lib/mocks/views";
import type { RuleFormState } from "./form-states";
import styles from "./mock-sets.module.css";

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].map((method) => ({ value: method, label: method }));

interface RuleFormProps {
  action: (previous: RuleFormState, formData: FormData) => Promise<RuleFormState>;
  initial: RuleFormState;
  submitLabel: string;
  cancelHref: string;
}

/**
 * New rule and Edit rule (add-mock-sets, design decision 18; mock-sets spec,
 * "Rules are written and edited in a form"): the request, with its method,
 * pattern, query matching, and body matching, then the responses, answered in
 * order, then the last again. Add response, and each response's Remove,
 * submit the form, so it works without JavaScript. A body its content type
 * says is JSON must be valid JSON. An edit someone else saved first shows
 * their values to change again.
 */
export function RuleForm({ action, initial, submitLabel, cancelHref }: RuleFormProps) {
  return (
    <ActionForm action={action} initial={initial} alertId="rule-form-alert">
      {(state) => {
        const { values, errors } = state;
        return (
          <div className={formStyles.form}>
            <HiddenFields values={{ lockVersion: String(state.lockVersion), responseCount: String(values.responses.length) }} />
            {/* Enter in a field saves, as the form's first submit button does, rather than adding a response. */}
            <button type="submit" name="intent" value="save" className="visually-hidden" tabIndex={-1} aria-hidden="true">
              {submitLabel}
            </button>
            {errors.base && <FormAlert id="rule-form-alert">{errors.base.join(" ")}</FormAlert>}
            <FormSection title="Request" description="The calls the rule answers. A rule matches a call when its method, pattern, query, and body all match.">
              <Select id="rule-method" name="method" label="Method" defaultValue={values.method} errors={errors.method} options={[...METHODS, { value: "*", label: "Any method" }]} />
              <TextInput
                id="rule-pattern"
                name="pattern"
                label="Pattern"
                mono
                required
                defaultValue={values.pattern}
                errors={errors.pattern}
                description="The path from the API's root, such as /v1/accounts/:id. Name each part that changes with :name, and end with * to match the rest of the path."
              />
              <TextInput id="rule-origin" name="origin" label="Recorded origin" optional mono defaultValue={values.origin} errors={errors.origin} description="Where the call was recorded, such as https://dev-api.example.test. It counts only when the mock set maps hosts." />
              <ChoiceGroup
                id="rule-query-mode"
                name="queryMode"
                legend="Query"
                type="radio"
                selected={[values.queryMode]}
                errors={errors.queryMode}
                choices={[
                  { value: "exact", label: "Exactly these parameters", description: "The same names and values, in any order." },
                  { value: "ignore_listed", label: "These parameters, ignoring some", description: "Exact, apart from the parameters named below, such as a cache buster." },
                  { value: "ignore_all", label: "Any query" },
                ]}
              />
              <TextArea id="rule-query" name="query" label="Query parameters" optional rows={3} defaultValue={values.query} errors={errors.query} description="One name=value a line." />
              <TextInput id="rule-query-ignored" name="queryIgnored" label="Ignored parameters" optional mono defaultValue={values.queryIgnored} errors={errors.queryIgnored} description="Names separated by commas, such as _." />
              <ChoiceGroup
                id="rule-body-mode"
                name="bodyMode"
                legend="Body"
                type="radio"
                selected={[values.bodyMode]}
                errors={errors.bodyMode}
                choices={[
                  { value: "ignore", label: "Any body" },
                  { value: "exact", label: "Exactly this text" },
                  { value: "json", label: "The same JSON", description: "Members in any order, and any spacing." },
                ]}
              />
              <TextArea id="rule-body" name="body" label="Body to compare" optional rows={4} defaultValue={values.body} errors={errors.body} description="Up to 64 KB, compared as the body option says." />
            </FormSection>
            <FormSection title="Responses" description="Repeated calls get the responses in order, then the last again. The order starts over when the page loads again, and when the rule changes.">
              <div className={styles.responses}>
                {values.responses.length === 0 && <p className={styles.kept}>No response yet. The rule answers nothing until it has one and it&apos;s turned on.</p>}
                {errors.responses && <p className={formStyles.error}>{errors.responses.join(" ")}</p>}
                {values.responses.map((response, index) => (
                  <ResponseFieldset key={`${index}:${state.submission ?? 0}`} index={index} response={response} errors={errors} count={values.responses.length} />
                ))}
                <div>
                  <SubmitButton name="intent" value="add-response" variant="secondary" icon="plus" pendingLabel="Adding">
                    Add response
                  </SubmitButton>
                </div>
              </div>
            </FormSection>
            <Checkbox id="rule-enabled" name="enabled" value="yes" label="Turned on" defaultChecked={values.enabled} description="A rule that's off, or has no response, answers nothing." />
            <FormFooter>
              <ButtonLink href={cancelHref}>Cancel</ButtonLink>
              <SubmitButton variant="primary" name="intent" value="save" pendingLabel="Saving">
                {submitLabel}
              </SubmitButton>
            </FormFooter>
          </div>
        );
      }}
    </ActionForm>
  );
}

function ResponseFieldset({ index, response, errors, count }: { index: number; response: ResponseFields; errors: RuleFormState["errors"]; count: number }) {
  const field = (name: string) => `responses.${index}.${name}`;
  const id = (name: string) => `response-${index}-${name}`;
  return (
    <fieldset className={styles.response} aria-labelledby={id("title")}>
      <p id={id("title")} className={styles.responseTitle}>{count === 1 ? "Response" : `Response ${index + 1}`}</p>
      <div className={styles.row}>
        <TextInput id={id("status")} name={field("status")} label="Status" inputMode="numeric" defaultValue={response.status} errors={errors[field("status")]} />
        <TextInput id={id("content-type")} name={field("contentType")} label="Content type" optional mono defaultValue={response.contentType} />
        <TextInput id={id("latency")} name={field("latencyMs")} label="Latency in milliseconds" inputMode="numeric" defaultValue={response.latencyMs} errors={errors[field("latencyMs")]} />
      </div>
      <TextArea id={id("headers")} name={field("headers")} label="Headers" optional rows={2} defaultValue={response.headers} errors={errors[field("headers")]} description="One Name: value a line. Set-Cookie isn't allowed, and Content-Length is computed." />
      {response.keep ? (
        <>
          <HiddenFields values={{ [field("keep")]: response.keep, [field("keepSize")]: String(response.keepSize) }} />
          <p className={styles.kept}>{`The body is kept as stored: ${response.contentType || "binary"}, ${formatBytes(response.keepSize)}. It can't be edited here.`}</p>
        </>
      ) : (
        <TextArea id={id("body")} name={field("body")} label="Body" optional rows={6} defaultValue={response.body} errors={errors[field("body")]} description="Up to 5 MB. A JSON content type needs valid JSON." />
      )}
      <Checkbox id={id("remove")} name={field("remove")} value="yes" label="Remove this response when saving" />
    </fieldset>
  );
}
