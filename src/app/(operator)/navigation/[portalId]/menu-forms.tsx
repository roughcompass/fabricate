"use client";

import { type DialogAction, type DialogState, DialogForm, FormDialog } from "@/components/onboarding/form-dialog";
import type { ButtonSize, ButtonVariant } from "@/components/ui/button-content";
import { Select, TextInput } from "@/components/ui/form";
import type { IconName } from "@/components/ui/icon";

/*
 * The Navigation page's menu forms (navigation spec, "The menu is edited
 * directly"): add an item or a group, rename an entry, and move one into
 * another group. Each opens in a dialog once JavaScript runs; before then its
 * trigger leads to the same form on the page, at #menu-form.
 */

export interface Choice {
  value: string;
  label: string;
}

const value = (state: DialogState, name: string, fallback = "") => {
  const entry = state.values[name];
  return (Array.isArray(entry) ? entry[0] : entry) ?? fallback;
};

interface Shared {
  action: DialogAction;
  lockVersion: number;
  portal: string;
  /** Where Cancel goes on the inline form. */
  cancelHref: string;
}

type Trigger = { label: string; icon?: IconName; variant?: ButtonVariant; size?: ButtonSize };

/** Shows +form+ as a dialog behind +trigger+, or inline when +inline+, as before JavaScript runs. */
function Opened({ inline, trigger, fallbackHref, cancelHref, ...form }: Omit<React.ComponentProps<typeof DialogForm>, "titleId" | "onCancel"> & { inline: boolean; trigger: Trigger; fallbackHref: string; cancelHref: string }) {
  return inline ? <DialogForm {...form} cancelHref={cancelHref} /> : <FormDialog {...form} trigger={trigger} fallbackHref={fallbackHref} />;
}

/**
 * Adds a menu item: a label, a route, one of the Portal's Applications, and
 * the group it goes in. Add to menu opens it with the Application chosen.
 */
export function AddItemForm({ action, lockVersion, portal, cancelHref, applications, groups, application = "", trigger, fallbackHref, inline = false, id = "add-item" }: Shared & { applications: readonly Choice[]; groups: readonly Choice[]; application?: string; trigger: Trigger; fallbackHref: string; inline?: boolean; id?: string }) {
  return (
    <Opened
      id={id}
      inline={inline}
      action={action}
      fields={{ lockVersion: String(lockVersion) }}
      title={`Add a menu item to ${portal}`}
      description="An item routes a path in the Portal to one of its Applications. It takes effect at once."
      confirmLabel="Add item"
      trigger={trigger}
      fallbackHref={fallbackHref}
      cancelHref={cancelHref}
    >
      {(state) => (
        <>
          <TextInput id={`${id}-label`} name="label" label="Label" defaultValue={value(state, "label")} errors={state.errors.label} required maxLength={100} description="What people see in the menu, such as Payees." />
          <TextInput id={`${id}-route`} name="route" label="Route" mono defaultValue={value(state, "route")} errors={state.errors.route} required maxLength={200} autoComplete="off" description="Starts with / and uses lowercase letters, digits, hyphens, and slashes, such as /payees. Each route is used once in the Portal." />
          <Select id={`${id}-application`} name="application" label="Application" defaultValue={value(state, "application", application)} errors={state.errors.application} required description={`Only Applications registered in ${portal} are offered.`} options={[{ value: "", label: "Choose an Application" }, ...applications]} />
          <Select id={`${id}-parent`} name="parent" label="Group" defaultValue={value(state, "parent")} errors={state.errors.parent} options={[{ value: "", label: "Top level" }, ...groups]} />
        </>
      )}
    </Opened>
  );
}

/** Adds a group: a label and where it goes. */
export function AddGroupForm({ action, lockVersion, portal, cancelHref, groups, trigger, fallbackHref, inline = false }: Shared & { groups: readonly Choice[]; trigger: Trigger; fallbackHref: string; inline?: boolean }) {
  return (
    <Opened
      id="add-group"
      inline={inline}
      action={action}
      fields={{ lockVersion: String(lockVersion) }}
      title={`Add a menu group to ${portal}`}
      description="A group holds items and other groups. Menus nest at most five levels deep."
      confirmLabel="Add group"
      trigger={trigger}
      fallbackHref={fallbackHref}
      cancelHref={cancelHref}
    >
      {(state) => (
        <>
          <TextInput id="add-group-label" name="label" label="Label" defaultValue={value(state, "label")} errors={state.errors.label} required maxLength={100} description="Such as Payments." />
          <Select id="add-group-parent" name="parent" label="Inside" defaultValue={value(state, "parent")} errors={state.errors.parent} options={[{ value: "", label: "Top level" }, ...groups]} />
        </>
      )}
    </Opened>
  );
}

/** Renames a group or an item, shown on the page from its menu. */
export function RenameForm({ action, lockVersion, cancelHref, entry }: Omit<Shared, "portal"> & { entry: { publicId: string; label: string; kind: "group" | "item" } }) {
  return (
    <DialogForm
      id="rename"
      action={action}
      fields={{ lockVersion: String(lockVersion), entry: entry.publicId }}
      title={`Rename ${entry.label}`}
      description={entry.kind === "group" ? "The group keeps what it holds." : "The item keeps its route and Application."}
      confirmLabel="Rename"
      cancelHref={cancelHref}
    >
      {(state) => <TextInput id="rename-label" name="label" label="Label" defaultValue={value(state, "label", entry.label)} errors={state.errors.label} required maxLength={100} />}
    </DialogForm>
  );
}

/** Moves a group or an item into another group, or to the top level, at the end. */
export function MoveIntoForm({ action, lockVersion, cancelHref, entry, targets }: Omit<Shared, "portal"> & { entry: { publicId: string; label: string; parent: string | null }; targets: readonly Choice[] }) {
  return (
    <DialogForm
      id="move-into"
      action={action}
      fields={{ lockVersion: String(lockVersion), entry: entry.publicId }}
      title={`Move ${entry.label}`}
      description="It goes at the end of the group you choose, with everything it holds."
      confirmLabel="Move"
      cancelHref={cancelHref}
    >
      {(state) => <Select id="move-into-target" name="into" label="Into" defaultValue={value(state, "into", entry.parent ?? "")} errors={state.errors.parent ?? state.errors.into} options={[{ value: "", label: "Top level" }, ...targets]} />}
    </DialogForm>
  );
}
