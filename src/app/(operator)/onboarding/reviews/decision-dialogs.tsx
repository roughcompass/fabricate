"use client";

import { ActorField } from "@/components/onboarding/draft-form";
import { type DialogAction, DialogForm, type DialogState, FormDialog } from "@/components/onboarding/form-dialog";
import type { ButtonVariant } from "@/components/ui/button-content";
import { ChoiceGroup, Select, TextArea, TextInput } from "@/components/ui/form";
import type { IconName } from "@/components/ui/icon";

interface DialogProps {
  id: string;
  action: DialogAction;
  /** The decision is made against this many earlier decisions; a newer one makes it stale. */
  expectedSequence: number;
  actor: string;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  tone?: "default" | "danger";
  trigger: { label: string; icon?: IconName; variant?: ButtonVariant };
  fallbackHref: string;
  inline?: boolean;
  cancelHref: string;
  /** True when the decision doesn't apply now: the trigger hides, and an open dialog stays with what was entered. */
  unavailable?: boolean;
}

const text = (state: DialogState, field: string) => (typeof state.values[field] === "string" ? (state.values[field] as string) : "");
const list = (state: DialogState, field: string) => {
  const entry = state.values[field];
  return Array.isArray(entry) ? entry : typeof entry === "string" ? [entry] : [];
};

function Shell({ inline, cancelHref, trigger, fallbackHref, expectedSequence, actor, unavailable = false, initialValues = {}, children, ...form }: DialogProps & { initialValues?: DialogState["values"]; children: (state: DialogState) => React.ReactNode }) {
  const initial: DialogState = { values: { actor, ...initialValues }, errors: {} };
  const fields = { expectedSequence: String(expectedSequence) };
  if (inline) return <DialogForm {...form} fields={fields} initial={initial} cancelHref={cancelHref}>{children}</DialogForm>;
  return (
    <FormDialog {...form} fields={fields} initial={initial} trigger={trigger} fallbackHref={fallbackHref} hidden={unavailable} returnFocus="#decisions">
      {children}
    </FormDialog>
  );
}

export interface Requested {
  route: string;
  menuParent: string;
  label: string;
  order: string;
  codes: string;
  operator: string;
  /** The environments the approval suggests making it the default of: those it asked for that have none. */
  defaults: string[];
}

/**
 * Approves a placement with the values the Portal's owner accepts, which
 * start as the requested ones: route, menu group, label, position,
 * entitlements, and the environments it becomes the default of.
 */
export function ApproveDialog({ requested, menu, environments, ...props }: DialogProps & { requested: Requested; menu: readonly { value: string; label: string }[]; environments: readonly string[] }) {
  return (
    <Shell {...props} initialValues={{ route: requested.route, menuParent: requested.menuParent, label: requested.label, order: requested.order, codes: requested.codes, operator: requested.operator, defaults: requested.defaults }}>
      {(state) => (
        <>
          <TextInput id={`${props.id}-route`} name="route" label="Route" mono defaultValue={text(state, "route")} errors={state.errors.route} description="The route the Portal serves it at. It starts as the one requested." maxLength={300} required />
          <Select id={`${props.id}-menuParent`} name="menuParent" label="Menu group" defaultValue={text(state, "menuParent")} errors={state.errors.menuParent} options={[{ value: "", label: "Top level" }, ...menu]} />
          <TextInput id={`${props.id}-label`} name="label" label="Menu label" defaultValue={text(state, "label")} errors={state.errors.label} maxLength={100} required />
          <TextInput id={`${props.id}-order`} name="order" label="Position" inputMode="numeric" defaultValue={text(state, "order")} errors={state.errors.order} maxLength={6} />
          <TextArea id={`${props.id}-codes`} name="codes" label="Entitlement codes" optional rows={2} defaultValue={text(state, "codes")} errors={Object.entries(state.errors).flatMap(([key, messages]) => (key.startsWith("entitlements") && messages ? messages : []))} description="One per line. None means no restriction beyond the Portal's." />
          <Select id={`${props.id}-operator`} name="operator" label="A visitor needs" defaultValue={text(state, "operator") || "any"} options={[{ value: "any", label: "Any one of them" }, { value: "all", label: "All of them" }]} />
          <ChoiceGroup id={`${props.id}-defaults`} name="defaults" legend="Make it the default route in" type="checkbox" columns optional selected={list(state, "defaults")} errors={state.errors.defaults} choices={environments.map((environment) => ({ value: environment, label: environment.toUpperCase() }))} />
          <ActorField state={state} id={`${props.id}-actor`} />
        </>
      )}
    </Shell>
  );
}

export interface Replacement {
  environment: string;
  options: { value: string; label: string }[];
}

/**
 * Rejects, withdraws, or retires a placement, with a reason, and, when the
 * placement is a default route that's going away, the approved placement
 * that takes over each of its environments.
 */
export function DecisionDialog({ reasonRequired, replacements = [], ...props }: DialogProps & { reasonRequired: boolean; replacements?: readonly Replacement[] }) {
  return (
    <Shell {...props}>
      {(state) => (
        <>
          <TextArea id={`${props.id}-reason`} name="reason" label="Reason" optional={!reasonRequired} rows={3} defaultValue={text(state, "reason")} errors={state.errors.reason} description={reasonRequired ? "Recorded with the decision, and shown to the Application team." : undefined} maxLength={1000} required={reasonRequired} />
          {replacements.map((replacement) => (
            <Select
              key={replacement.environment}
              id={`${props.id}-replacement-${replacement.environment}`}
              name={`replacement.${replacement.environment}`}
              label={`New default route in ${replacement.environment.toUpperCase()}`}
              defaultValue={text(state, `replacement.${replacement.environment}`)}
              errors={state.errors[`replacement.${replacement.environment}`]}
              description="This placement is the default there now. Another approved placement must take over."
              options={[{ value: "", label: replacement.options.length ? "Choose a placement" : "No other approved placement" }, ...replacement.options]}
            />
          ))}
          <ActorField state={state} id={`${props.id}-actor`} />
        </>
      )}
    </Shell>
  );
}
