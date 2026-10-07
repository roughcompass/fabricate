"use client";

import { useActionState, useEffect, useId, useRef, useSyncExternalStore } from "react";
import { ButtonLink } from "@/components/ui/button";
import { type ButtonSize, type ButtonVariant, ButtonContent, buttonProps } from "@/components/ui/button-content";
import { FormAlert, FormFooter, type FormState, formStyles } from "@/components/ui/form";
import type { IconName } from "@/components/ui/icon";
import { Panel } from "@/components/ui/panel";
import { SubmitButton } from "@/components/ui/submit-button";
import { useFocusFirstInvalid } from "@/components/ui/use-focus-first-invalid";
import styles from "@/components/ui/confirm-dialog.module.css";

export type DialogValues = Record<string, string | string[]>;
export type DialogState = FormState<DialogValues>;
export type DialogAction = (previous: DialogState, formData: FormData) => Promise<DialogState>;

const subscribeNever = () => () => {};

interface DialogFormProps {
  id: string;
  action: DialogAction;
  initial?: DialogState;
  /** Hidden fields submitted with the action, such as a lock version. */
  fields?: Record<string, string>;
  title: string;
  /** What happens, stated once. */
  description: React.ReactNode;
  confirmLabel: string;
  tone?: "default" | "danger";
  children?: (state: DialogState) => React.ReactNode;
}

interface FormDialogProps extends DialogFormProps {
  trigger: { label: string; icon?: IconName; variant?: ButtonVariant; size?: ButtonSize };
  /** Where the trigger leads before JavaScript runs: this page with the form shown inline. */
  fallbackHref: string;
  /**
   * Hides the trigger while keeping the dialog mounted, such as when the
   * action no longer applies after someone else's change: an open dialog
   * keeps what was entered and its message about the change.
   */
  hidden?: boolean;
  /** What takes focus when the dialog closes and its trigger is hidden, such as the record that changed. */
  returnFocus?: string;
}

/**
 * An action that needs a few fields, such as a reason and who's acting, in an
 * in-app dialog: it names the action, states what happens, and offers Cancel
 * and the verb. A rejected submission keeps the dialog open with what was
 * entered and the problem at its field. Before JavaScript runs, the trigger
 * opens the same form on the page itself.
 */
export function FormDialog({ trigger, fallbackHref, hidden = false, returnFocus, ...form }: FormDialogProps) {
  const hydrated = useSyncExternalStore(subscribeNever, () => true, () => false);
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  if (!hydrated) {
    if (hidden) return null;
    return (
      <ButtonLink href={fallbackHref} variant={trigger.variant} size={trigger.size} icon={trigger.icon}>
        {trigger.label}
      </ButtonLink>
    );
  }
  const restoreFocus = () => {
    if (!hidden || !returnFocus) return opener.current?.focus();
    const target = document.querySelector<HTMLElement>(returnFocus);
    if (!target) return;
    if (!target.matches("a, button, input, select, textarea, [tabindex]")) target.tabIndex = -1;
    target.focus();
  };
  return (
    <>
      <button ref={opener} type="button" hidden={hidden} {...buttonProps(trigger.variant ?? "secondary", trigger.size ?? "md")} aria-haspopup="dialog" onClick={() => dialog.current?.showModal()}>
        <ButtonContent icon={trigger.icon} size={trigger.size}>
          {trigger.label}
        </ButtonContent>
      </button>
      <dialog ref={dialog} className={styles.dialog} aria-labelledby={titleId} onClose={restoreFocus}>
        <DialogForm {...form} titleId={titleId} onCancel={() => dialog.current?.close()} />
      </dialog>
    </>
  );
}

/** The dialog's form, also shown inline in place of the dialog before JavaScript runs. */
export function DialogForm({ id, action, initial = { values: {}, errors: {} }, fields = {}, title, description, confirmLabel, tone = "default", children, titleId, onCancel, cancelHref }: DialogFormProps & { titleId?: string; onCancel?: () => void; cancelHref?: string }) {
  const [state, formAction] = useActionState(action, initial);
  const form = useFocusFirstInvalid(state, `${id}-alert`);
  const footer = (
    <FormFooter>
      {onCancel ? (
        <button type="button" {...buttonProps("secondary")} onClick={onCancel}>
          Cancel
        </button>
      ) : (
        <ButtonLink href={cancelHref ?? "?"}>Cancel</ButtonLink>
      )}
      <SubmitButton variant={tone === "danger" ? "danger" : "primary"}>{confirmLabel}</SubmitButton>
    </FormFooter>
  );
  // Focus moves into the dialog's first field when it opens.
  useEffect(() => {
    if (!onCancel) return;
    const element = form.current?.closest("dialog");
    const focusFirst = () => form.current?.querySelector<HTMLElement>("input:not([type=hidden]), textarea, select, button[type=submit]")?.focus();
    element?.addEventListener("toggle", focusFirst);
    return () => element?.removeEventListener("toggle", focusFirst);
  }, [form, onCancel]);
  const body = (
    <div className={formStyles.form}>
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {state.errors.base && <FormAlert id={`${id}-alert`}>{state.errors.base.join(" ")}</FormAlert>}
      {children?.(state)}
    </div>
  );
  return (
    <form ref={form} action={formAction} noValidate data-dialog-form={id}>
      {onCancel ? (
        <>
          <div className={styles.body}>
            <h2 id={titleId} className={styles.title}>
              {title}
            </h2>
            <div className={styles.description}>{description}</div>
            {body}
          </div>
          <div className={styles.footer}>{footer}</div>
        </>
      ) : (
        <Panel title={title} description={description} footer={footer} level={2}>
          {body}
        </Panel>
      )}
    </form>
  );
}
