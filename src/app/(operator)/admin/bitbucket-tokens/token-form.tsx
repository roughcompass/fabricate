"use client";

import { ButtonLink } from "@/components/ui/button";
import { ActionForm, FormAlert, FormFooter, TextInput, formStyles } from "@/components/ui/form";
import { Panel } from "@/components/ui/panel";
import { SubmitButton } from "@/components/ui/submit-button";
import type { TokenFormState } from "./form-state";
import { BITBUCKET_TOKENS_HREF } from "./paths";

/**
 * The Add token form: the token's owner first, then its server, and the
 * token in a password field the browser won't offer to remember. A refused
 * submission keeps the owner and server, never the token.
 */
export function TokenForm({ action }: { action: (previous: TokenFormState, formData: FormData) => Promise<TokenFormState> }) {
  return (
    <ActionForm action={action} initial={{ values: { name: "", serverUrl: "" }, errors: {} }} alertId="token-form-alert">
      {(state) => (
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
            <TextInput id="token-owner" name="name" label="Owner" defaultValue={state.values.name} errors={state.errors.name} description="Who the token belongs to, such as a person or a team. An owner has one token per server." required maxLength={100} />
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
      )}
    </ActionForm>
  );
}
