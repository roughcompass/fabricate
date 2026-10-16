"use client";

import { useActionState } from "react";
import { FormAlert, FormFooter, FormSection, TextArea, TextInput, formStyles } from "@/components/ui/form";
import { Panel } from "@/components/ui/panel";
import { SubmitButton } from "@/components/ui/submit-button";
import { useFocusFirstInvalid } from "@/components/ui/use-focus-first-invalid";
import { SHELL_LIMITS } from "@/lib/prototypes/shell";
import type { ShellFormState } from "./actions";

/**
 * The Page shell form (page-shell spec, "The shell's contents are workspace
 * data"): the application's name, the navigation, and the footer. Navigation
 * items and footer links are one per line, so the form works without
 * JavaScript.
 */
export function ShellForm({ action, initial }: { action: (previous: ShellFormState, formData: FormData) => Promise<ShellFormState>; initial: ShellFormState }) {
  const [state, formAction] = useActionState(action, initial);
  const form = useFocusFirstInvalid(state, "shell-form-alert");
  return (
    <form ref={form} action={formAction} noValidate>
      <Panel
        footer={
          <FormFooter>
            <SubmitButton pendingLabel="Saving">Save shell</SubmitButton>
          </FormFooter>
        }
      >
        <div className={formStyles.form}>
          {state.errors.base && <FormAlert id="shell-form-alert">{state.errors.base.join(" ")}</FormAlert>}
          <FormSection title="Header">
            <TextInput id="shell-app-name" name="appName" label="Application name" description="Shown in the header of every page prototype." defaultValue={state.values.appName} errors={state.errors.appName} required maxLength={SHELL_LIMITS.appName} />
          </FormSection>
          <FormSection title="Navigation">
            <TextArea
              id="shell-nav"
              name="nav"
              label="Navigation items"
              description={`One item per line, ${SHELL_LIMITS.nav.min} to ${SHELL_LIMITS.nav.max} items. List up to ${SHELL_LIMITS.children} children after a colon, separated by commas, such as Payments: Approvals, Payment history.`}
              rows={8}
              defaultValue={state.values.nav}
              errors={state.errors.nav}
              required
            />
          </FormSection>
          <FormSection title="Footer">
            <TextInput id="shell-footer-text" name="footerText" label="Footer text" optional defaultValue={state.values.footerText} errors={state.errors.footerText} maxLength={SHELL_LIMITS.footerText} />
            <TextArea
              id="shell-footer-links"
              name="footerLinks"
              label="Footer links"
              description={`One link per line, up to ${SHELL_LIMITS.footerLinks}, as its text, a colon, and an in-page address, such as Help: #help.`}
              optional
              rows={5}
              defaultValue={state.values.footerLinks}
              errors={state.errors.footerLinks}
            />
          </FormSection>
        </div>
      </Panel>
    </form>
  );
}
