"use client";

import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { FormAlert, Select, TextArea, TextInput } from "@/components/ui/form";
import { useFocusFirstInvalid } from "@/components/ui/use-focus-first-invalid";
import type { LoggedCall } from "../routing/mock-log";
import { useTargetDocument } from "../target-document";
import { type Errors, type RuleDraft, useData } from "./data-state";
import styles from "./data.module.css";

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].map((method) => ({ value: method, label: method }));
const QUERY_MODES = [
  { value: "exact", label: "Exact: the same parameters and values" },
  { value: "ignore_listed", label: "Ignore listed parameters" },
  { value: "ignore_all", label: "Ignore the query" },
];
const BODY_MODES = [
  { value: "ignore", label: "Ignore the body" },
  { value: "json", label: "JSON-equal" },
  { value: "exact", label: "Exact text" },
];

/** The path a rule matches a call by: the part after the build's path for a call under it, otherwise the call's own path. */
export function callPath(url: URL, base: string, origin: string): string {
  if (url.origin === origin && url.pathname.startsWith(base)) return `/${url.pathname.slice(base.length)}`;
  return url.pathname;
}

/** Whether +text+ is JSON. */
function isJson(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Create rule, in the Data panel (add-mock-sets, design decision 15;
 * template-demo/mock-data spec, "A rule can be created from a call"): the
 * call's method, path, query, and body, and a response written here. A rule
 * saved without a response is added as Needs a response, and answers
 * nothing until one is written on its page.
 */
export function RuleForm({ call, set, onDone }: { call: LoggedCall; set: { publicId: string; name: string }; onDone: () => void }) {
  const data = useData();
  const target = useTargetDocument();
  const url = new URL(call.url);
  const query = [...url.searchParams.entries()];
  const [method, setMethod] = useState(call.method.toUpperCase());
  const [pattern, setPattern] = useState(() => callPath(url, target.base, window.location.origin));
  const [queryMode, setQueryMode] = useState<RuleDraft["queryMode"]>(query.length ? "exact" : "ignore_all");
  const [ignored, setIgnored] = useState("");
  const [bodyMode, setBodyMode] = useState<RuleDraft["bodyMode"]>(call.body === null ? "ignore" : isJson(call.body) ? "json" : "exact");
  const [status, setStatus] = useState("");
  const [contentType, setContentType] = useState("application/json");
  const [body, setBody] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const alertId = useId();
  const form = useFocusFirstInvalid(errors, alertId);

  useEffect(() => {
    form.current?.querySelector<HTMLElement>("#rule-method")?.focus();
  }, [form]);

  const check = (): Errors => {
    const found: Errors = {};
    if (!pattern.startsWith("/")) found.pattern = ["Enter a path that starts with /, such as /v1/accounts/:id"];
    const written = status.trim() !== "" || body.trim() !== "";
    if (written) {
      const code = Number(status.trim() || "200");
      if (!Number.isInteger(code) || code < 200 || code > 599) found.status = ["Enter a status from 200 to 599"];
      if (/json/i.test(contentType) && body.trim() && !isJson(body)) found.body = ["The body isn't valid JSON"];
    }
    return found;
  };

  const submit = async () => {
    const found = check();
    setErrors(found);
    if (Object.keys(found).length) return;
    const written = status.trim() !== "" || body.trim() !== "";
    const draft: RuleDraft = {
      method,
      pattern,
      queryMode,
      query: queryMode === "ignore_all" ? [] : query,
      queryIgnored: queryMode === "ignore_listed" ? ignored.split(/[\s,]+/).filter(Boolean) : [],
      bodyMode,
      body: bodyMode === "ignore" ? null : call.body,
      response: written ? { status: Number(status.trim() || "200"), contentType: contentType.trim() || null, body } : null,
    };
    setSaving(true);
    const result = await data.createRule(set.publicId, draft);
    setSaving(false);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setSaved(written ? `Added ${method} ${pattern} to ${set.name}. The next call uses it.` : `Added ${method} ${pattern} to ${set.name}, needing a response. It answers nothing until one is written on its page.`);
  };

  if (saved)
    return (
      <div className={styles.form} data-rule-saved="">
        <p role="status">{saved}</p>
        <div className={styles.actions}>
          <Button size="sm" onClick={onDone}>
            Done
          </Button>
        </div>
      </div>
    );

  return (
    <form
      ref={form}
      className={styles.form}
      aria-label="Create rule"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <h4 className={styles.formTitle}>Create rule</h4>
      <p className={styles.muted}>{`Adds a rule to ${set.name} that answers this call from the next one. Leave the status and body empty to add it needing a response, which answers nothing until one is written.`}</p>
      {errors.base && (
        <FormAlert id={alertId} title="The rule was not created">
          {errors.base.map((message) => (
            <p key={message}>{message}</p>
          ))}
        </FormAlert>
      )}
      <Select id="rule-method" label="Method" value={method} onChange={(event) => setMethod(event.currentTarget.value)} options={METHODS} errors={errors.method} />
      <TextInput id="rule-pattern" label="Path" mono value={pattern} onChange={(event) => setPattern(event.currentTarget.value)} description="Name a part that changes with :name, such as /v1/accounts/:id, or end with * for the rest of the path." errors={errors.pattern} autoComplete="off" spellCheck={false} />
      {query.length > 0 && (
        <>
          <Select id="rule-query" label="Query" value={queryMode} onChange={(event) => setQueryMode(event.currentTarget.value as RuleDraft["queryMode"])} options={QUERY_MODES} description={`This call's: ${url.search}`} errors={errors.queryMode} />
          {queryMode === "ignore_listed" && <TextInput id="rule-query-ignored" label="Parameters to ignore" mono value={ignored} onChange={(event) => setIgnored(event.currentTarget.value)} description="Names, separated by commas." errors={errors.queryIgnored} />}
        </>
      )}
      {call.body !== null && <Select id="rule-body-mode" label="Request body" value={bodyMode} onChange={(event) => setBodyMode(event.currentTarget.value as RuleDraft["bodyMode"])} options={BODY_MODES} errors={errors.bodyMode} />}
      <TextInput id="rule-status" label="Status" optional inputMode="numeric" value={status} onChange={(event) => setStatus(event.currentTarget.value)} placeholder="200" errors={errors.status} />
      <TextInput id="rule-content-type" label="Content type" optional mono value={contentType} onChange={(event) => setContentType(event.currentTarget.value)} errors={errors.contentType} />
      <TextArea id="rule-body" label="Body" optional rows={4} value={body} onChange={(event) => setBody(event.currentTarget.value)} errors={errors.body} spellCheck={false} />
      <div className={styles.actions}>
        <Button type="submit" variant="primary" disabled={saving}>
          Create rule
        </Button>
        <Button variant="tertiary" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
