"use client";

import { useEffect, useRef, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ActionForm, FormAlert, FormFooter, formStyles, TextInput } from "@/components/ui/form";
import { PageAlertPortal } from "@/components/ui/page-alert-portal";
import { SubmitButton } from "@/components/ui/submit-button";
import { useToast } from "@/components/ui/toast";
import type { DemoFormState } from "./actions";

/** The indeterminate state can only be set from script. */
export function IndeterminateCheckbox({ id }: { id: string }) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (input.current) input.current.indeterminate = true;
  }, []);
  return (
    <label className={formStyles.checkboxRow} htmlFor={id}>
      <input ref={input} id={id} type="checkbox" className={formStyles.checkbox} />
      <span>Indeterminate</span>
    </label>
  );
}

/** Raises each kind of toast. */
export function ToastDemo() {
  const { toast } = useToast();
  const [count, setCount] = useState(0);
  return (
    <div data-toast-demo="">
      <Button onClick={() => toast({ title: "orders was added.", tone: "success" })}>Success</Button>{" "}
      <Button onClick={() => toast({ title: "Cancellation was requested.", tone: "info" })}>Info</Button>{" "}
      <Button onClick={() => toast({ title: "Added 3 of 5 selected Repositories.", description: "2 candidates could not be added.", tone: "warning" })}>Warning</Button>{" "}
      <Button onClick={() => toast({ title: "billing could not be added.", description: "Another Repository has the same clone URL.", tone: "error" })}>Error</Button>{" "}
      <Button
        onClick={() => {
          setCount(count + 1);
          toast({ id: "same-event", title: "Shown once per event." });
          toast({ id: "same-event", title: "Shown once per event." });
        }}
      >
        Same event twice
      </Button>{" "}
      <Button
        onClick={() => {
          for (const n of [1, 2, 3, 4]) toast({ title: `Toast ${n + count * 4}` });
          setCount(count + 1);
        }}
      >
        Four at once
      </Button>{" "}
      <Button onClick={() => toast({ title: "Control 2 was removed.", tone: "info", action: { label: "Undo", onAction: () => toast({ title: "Control 2 was restored." }) } })}>With Undo</Button>
    </div>
  );
}

/** Raises a page alert from a client component, as a failed launch does. */
export function AlertDemo() {
  const [shown, setShown] = useState(false);
  return (
    <>
      <Button onClick={() => setShown(true)}>Raise a page alert</Button>
      {shown && (
        <PageAlertPortal>
          <Alert tone="error" title="The Run was not started" live>
            <ul>
              <li>billing is disabled. Enable it or remove it from the Assessment.</li>
            </ul>
          </Alert>
        </PageAlertPortal>
      )}
    </>
  );
}

/** A form whose rejected submissions move focus: to the invalid field, or to the form alert. */
export function FocusDemo({ action }: { action: (previous: DemoFormState, formData: FormData) => Promise<DemoFormState> }) {
  return (
    <ActionForm action={action} initial={{ values: { name: "" }, errors: {} }} alertId="demo-form-alert" className={formStyles.form} aria-label="Focus demo">
      {(state) => (
        <>
          {state.errors.base && <FormAlert id="demo-form-alert">{state.errors.base.join(" ")}</FormAlert>}
          <TextInput id="demo-name" name="name" label="Name" description='Leave empty for a field error, or enter "stale" for a form error.' defaultValue={state.values.name} errors={state.errors.name} />
          <TextInput id="demo-other" name="other" label="Another field" optional />
          <FormFooter>
            <SubmitButton pendingLabel="Saving">Save changes</SubmitButton>
          </FormFooter>
        </>
      )}
    </ActionForm>
  );
}

/** Throws after hydration, to prove the e2e console guard catches page errors. */
export function InjectedError() {
  useEffect(() => {
    setTimeout(() => {
      throw new Error("Injected page error");
    });
  }, []);
  return null;
}
