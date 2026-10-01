"use client";

import { useId, useRef, useSyncExternalStore } from "react";
import { type ButtonSize, type ButtonVariant, ButtonContent, buttonClass } from "./button-content";
import type { IconName } from "./icon";
import { Menu, MenuButton } from "./menu";
import { SubmitButton } from "./submit-button";
import styles from "./confirm-dialog.module.css";

const subscribeNever = () => () => {};

interface ConfirmDialogProps {
  action: (formData: FormData) => void | Promise<void>;
  /** Hidden fields submitted with the action. */
  fields?: Record<string, string>;
  trigger: { label: string; icon?: IconName; variant?: ButtonVariant; size?: ButtonSize };
  /** Names the action and its object, such as "Cancel Assessment #3?". */
  title: string;
  /** The consequence, stated once. */
  children: React.ReactNode;
  /** The verb, such as "Cancel Assessment". */
  confirmLabel: string;
  tone?: "danger" | "default";
  /**
   * Puts the trigger in an overflow menu, after any other `items`, instead of
   * showing it as a button. `label` is the menu's accessible name.
   */
  menu?: { label: string; items?: React.ReactNode; variant?: ButtonVariant; size?: ButtonSize };
}

/**
 * Confirms a destructive or irreversible action in an in-app dialog: it names
 * the action, states its consequence, and offers Cancel and the verb. Escape
 * and Cancel close it without acting, and focus returns to the trigger. Before
 * JavaScript runs, the trigger submits the action directly.
 */
export function ConfirmDialog({ action, fields = {}, trigger, title, children, confirmLabel, tone = "default", menu }: ConfirmDialogProps) {
  const hydrated = useSyncExternalStore(subscribeNever, () => true, () => false);
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const danger = tone === "danger";
  const form = useRef<HTMLFormElement>(null);
  const open = () => {
    dialog.current?.showModal();
    // The safe choice is focused for destructive actions, the action otherwise.
    const target = danger ? cancel.current : dialog.current?.querySelector<HTMLButtonElement>('button[type="submit"]');
    target?.focus();
  };
  // Focus returns to what opened the dialog: the trigger, or the menu that held it.
  const returnFocus = () => (menu ? form.current?.querySelector<HTMLButtonElement>("button[popovertarget]") : opener.current)?.focus();

  return (
    <form ref={form} action={action} className={styles.form}>
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {menu ? (
        <Menu label={menu.label} variant={menu.variant} size={menu.size}>
          {menu.items}
          <MenuButton icon={trigger.icon} tone={danger ? "danger" : "default"} submit={!hydrated} onClick={hydrated ? open : undefined}>
            {trigger.label}
          </MenuButton>
        </Menu>
      ) : (
        <button
          ref={opener}
          type={hydrated ? "button" : "submit"}
          className={buttonClass(trigger.variant ?? "secondary", trigger.size ?? "md")}
          aria-haspopup={hydrated ? "dialog" : undefined}
          onClick={hydrated ? open : undefined}
        >
          <ButtonContent icon={trigger.icon} size={trigger.size}>
            {trigger.label}
          </ButtonContent>
        </button>
      )}
      {hydrated && (
        <dialog ref={dialog} className={styles.dialog} aria-labelledby={titleId} aria-describedby={descriptionId} onClose={returnFocus}>
          <div className={styles.body}>
            <h2 id={titleId} className={styles.title}>
              {title}
            </h2>
            <div id={descriptionId} className={styles.description}>
              {children}
            </div>
          </div>
          <div className={styles.footer}>
            <button ref={cancel} type="button" className={buttonClass("secondary")} onClick={() => dialog.current?.close()}>
              Cancel
            </button>
            <SubmitButton variant={danger ? "danger" : "primary"}>{confirmLabel}</SubmitButton>
          </div>
        </dialog>
      )}
    </form>
  );
}
