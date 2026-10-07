"use client";

import type { ButtonSize, ButtonVariant } from "@/components/ui/button-content";
import { Select, TextArea, TextInput } from "@/components/ui/form";
import type { IconName } from "@/components/ui/icon";
import { ActorField } from "./draft-form";
import { type DialogAction, DialogForm, FormDialog } from "./form-dialog";

interface BaseProps {
  id: string;
  action: DialogAction;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  tone?: "default" | "danger";
  fields?: Record<string, string>;
  actor: string;
  trigger: { label: string; icon?: IconName; variant?: ButtonVariant; size?: ButtonSize };
  /** This page with the dialog's form shown inline, for before JavaScript runs. */
  fallbackHref: string;
  /** Renders the form on the page instead of in a dialog: the fallback itself. */
  inline?: boolean;
  /** Where Cancel leads from the inline form. */
  cancelHref?: string;
}

function Shell({ inline, cancelHref, trigger, fallbackHref, children, ...form }: BaseProps & { children: Parameters<typeof DialogForm>[0]["children"] }) {
  const initial = { values: { actor: form.actor }, errors: {} };
  if (inline) return <DialogForm {...form} initial={initial} cancelHref={cancelHref}>{children}</DialogForm>;
  return (
    <FormDialog {...form} initial={initial} trigger={trigger} fallbackHref={fallbackHref}>
      {children}
    </FormDialog>
  );
}

const text = (values: Record<string, string | string[]>, field: string) => (typeof values[field] === "string" ? (values[field] as string) : "");

/** An action that needs only who's acting, such as starting a Draft or activating a revision. */
export function ActorDialog(props: BaseProps) {
  return <Shell {...props}>{(state) => <ActorField state={state} id={`${props.id}-actor`} />}</Shell>;
}

/** An action that needs a reason and who's acting, such as retiring or rejecting. */
export function ReasonDialog({ reasonLabel = "Reason", reasonDescription, ...props }: BaseProps & { reasonLabel?: string; reasonDescription?: string }) {
  return (
    <Shell {...props}>
      {(state) => (
        <>
          <TextArea id={`${props.id}-reason`} name="reason" label={reasonLabel} rows={3} defaultValue={text(state.values, "reason")} errors={state.errors.reason} description={reasonDescription} maxLength={1000} required />
          <ActorField state={state} id={`${props.id}-actor`} />
        </>
      )}
    </Shell>
  );
}

/** An action that chooses one of a few options, such as an environment's default placement. */
export function ChoiceDialog({ choiceLabel, name, options, selected, choiceDescription, ...props }: BaseProps & { choiceLabel: string; name: string; options: readonly { value: string; label: string }[]; selected?: string; choiceDescription?: string }) {
  return (
    <Shell {...props}>
      {(state) => (
        <>
          <Select id={`${props.id}-${name}`} name={name} label={choiceLabel} defaultValue={text(state.values, name) || selected || ""} errors={state.errors[name]} description={choiceDescription} options={options} />
          <ActorField state={state} id={`${props.id}-actor`} />
        </>
      )}
    </Shell>
  );
}

/** Maps a record to a Studio or CDaaS resource by its ID: an explicit statement, never a match by name. */
export function ReferenceDialog({ resourceTypes, environments, ...props }: BaseProps & { resourceTypes: readonly { value: string; label: string }[]; environments?: readonly string[] }) {
  return (
    <Shell {...props}>
      {(state) => (
        <>
          {resourceTypes.length > 1 ? (
            <Select id={`${props.id}-type`} name="resourceType" label="Resource" defaultValue={text(state.values, "resourceType")} errors={state.errors.resourceType} options={resourceTypes} />
          ) : (
            <input type="hidden" name="resourceType" value={resourceTypes[0]!.value} />
          )}
          <TextInput id={`${props.id}-external`} name="externalId" label="ID in that system" mono defaultValue={text(state.values, "externalId")} errors={state.errors.externalId} description="The resource's UUID, exactly as that system shows it." maxLength={128} required />
          {environments && environments.length > 0 && (
            <Select id={`${props.id}-environment`} name="environment" label="Environment" optional defaultValue={text(state.values, "environment")} errors={state.errors.environment} options={[{ value: "", label: "Not environment-specific" }, ...environments.map((environment) => ({ value: environment, label: environment.toUpperCase() }))]} description="For a Studio environment or menu, the environment it belongs to." />
          )}
          <ActorField state={state} id={`${props.id}-actor`} />
        </>
      )}
    </Shell>
  );
}
