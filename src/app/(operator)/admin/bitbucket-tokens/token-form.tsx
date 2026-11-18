"use client";

import { useActionState } from "react";
import { ButtonLink } from "@/components/ui/button";
import { FormAlert, FormFooter, TextInput, formStyles } from "@/components/ui/form";
import { Panel } from "@/components/ui/panel";
import { SubmitButton } from "@/components/ui/submit-button";
import { useFocusFirstInvalid } from "@/components/ui/use-focus-first-invalid";
import type { TokenFormState } from "./form-state";
import { BITBUCKET_TOKENS_HREF } from "./paths";

/**
 * The Add token form: the server, a name to tell tokens apart, and the token
 * in a password field the browser won't offer to remember. A refused
 * submission keeps the server and name, never the token.
 */
export function TokenForm({ action }: { action: (previous: TokenFormState, formData: FormData) => Promise<TokenFormState> }) {
  const [state, formAction] = useActionState(action, { values: { name: "", serverUrl: "" }, errors: {} });
  const form = useFocusFirstInvalid(state, "token-form-alert");
  return (
    <form ref={form} action={formAction} noValidate>
      <Panel
        footer={
          <FormFooter>
            <ButtonLink href={BITBUCKET_TOKENS_HREF}>Cancel</ButtonLink>
            <SubmitButton pendingLabel="Saving">Add token</SubmitButton>
          </FormFooter>
        }
      >
        <div className={formStyles.form}>
          {state.errors.base && <FormAlert id="token-form-alert">{state.errors.base.join(" ")}</FormAlert>}
          <TextInput
            id="token-server-url"
            name="serverUrl"
            label="Server"
            mono
            inputMode="url"
            placeholder="https://bitbucket.example.com"
            defaultValue={state.values.serverUrl}
            errors={state.errors.serverUrl}
            description="The Bitbucket Server or Data Center address, with its context path if it has one."
            required
          />
          <TextInput id="token-name" name="name" label="Name" defaultValue={state.values.name} errors={state.errors.name} description="What the token is for, such as a project or team, to tell tokens for the same server apart." required maxLength={100} />
          <TextInput
            id="token-value"
            name="token"
            label="Token"
            type="password"
            mono
            autoComplete="off"
            spellCheck={false}
            errors={state.errors.token}
            description="An HTTP access token or personal access token with read access to the repositories. After saving, it's shown only by its last four characters."
            required
          />
        </div>
      </Panel>
    </form>
  );
}
