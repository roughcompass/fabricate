"use client";

import { useId, useRef, useState } from "react";
import { buttonProps } from "@/components/ui/button-content";
import { countLabel } from "@/components/ui/count";
import { ActionForm } from "@/components/ui/form";
import { Icon } from "@/components/ui/icon";
import { SubmitButton } from "@/components/ui/submit-button";
import { useHydrated } from "@/components/ui/use-hydrated";
import type { DeletionEffects } from "@/lib/repositories/registration";
import { PRODUCT } from "@/lib/product";
import styles from "./settings.module.css";

interface DeleteRepositoryProps {
  name: string;
  effects: DeletionEffects;
  action: (previous: { error: string | null }, formData: FormData) => Promise<{ error: string | null }>;
}

/**
 * Delete this repository, confirmed as GitHub confirms it: a dialog that
 * first asks whether you want to, then states every effect and asks you to
 * say you read them, then asks you to type the repository's name, which
 * alone enables the button. The server checks the name again. Without
 * JavaScript, the last step stands on the page instead; CSS picks which one
 * shows, so hydrating never flashes the fallback.
 */
export function DeleteRepository({ name, effects, action }: DeleteRepositoryProps) {
  const hydrated = useHydrated();
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [typed, setTyped] = useState("");
  const titleId = useId();
  const inputId = useId();
  const matches = typed === name;

  const open = () => {
    setStep(1);
    setTyped("");
    dialog.current?.showModal();
  };

  const confirmation = (
    <ActionForm action={action} initial={{ error: null }} className={styles.confirm}>
      {(state) => (
        <>
          <label htmlFor={inputId} className={styles.confirmLabel}>
            To confirm, type &ldquo;<strong>{name}</strong>&rdquo; in the box below
          </label>
          <input
            id={inputId}
            name="confirmation"
            className={styles.confirmInput}
            autoComplete="off"
            spellCheck={false}
            autoCapitalize="off"
            value={hydrated ? typed : undefined}
            onChange={(event) => setTyped(event.target.value)}
            aria-invalid={state.error ? true : undefined}
            // Focused when the step opens, so the name can be typed at once.
            autoFocus={hydrated}
          />
          {state.error && (
            <p className={styles.confirmError} role="alert">
              {state.error}
            </p>
          )}
          <SubmitButton variant="danger" disabled={hydrated && !matches} pendingLabel="Deleting">
            Delete this repository
          </SubmitButton>
        </>
      )}
    </ActionForm>
  );

  return (
    <>
      {!hydrated && <div className={styles.inlineConfirm}>{confirmation}</div>}
      <button ref={opener} type="button" {...buttonProps("secondary")} className={`${buttonProps("secondary").className} ${styles.dangerButton} ${styles.trigger}`} aria-haspopup="dialog" onClick={open}>
        Delete this repository
      </button>
      <dialog ref={dialog} className={styles.dialog} aria-labelledby={titleId} onClose={() => opener.current?.focus()}>
        <div className={styles.dialogHeader}>
          <h2 id={titleId} className={styles.dialogTitle}>
            Delete {name}
          </h2>
          <button type="button" {...buttonProps("tertiary", "sm", true)} aria-label="Close" title="Close" onClick={() => dialog.current?.close()}>
            <Icon name="x" />
          </button>
        </div>
        <div className={styles.dialogRepository}>
          <Icon name="git" size={24} />
          <strong>{name}</strong>
          <span className={styles.muted}>
            {countLabel(effects.versions, "version")} · {countLabel(effects.runs, "Run")}
          </span>
        </div>

        {step === 1 && (
          <div className={styles.dialogStep}>
            <button type="button" {...buttonProps("secondary")} className={`${buttonProps("secondary").className} ${styles.wide}`} onClick={() => setStep(2)}>
              I want to delete this repository
            </button>
          </div>
        )}

        {step === 2 && (
          <div className={styles.dialogStep}>
            <div className={styles.warning} role="note">
              <Icon name="alert" />
              <span>Unexpected bad things will happen if you don&apos;t read this!</span>
            </div>
            <ul className={styles.effects}>
              <li>
                This will permanently delete <strong>{name}</strong> from the {PRODUCT.name}. It can&apos;t be restored, and its clone URL can be registered again only as a new Repository.
              </li>
              <li>{effects.versions ? `Its ${countLabel(effects.versions, "version")} will no longer be shown; a version in progress finishes.` : "It has no versions yet."}</li>
              <li>
                {effects.assessments.length
                  ? `${countLabel(effects.assessments.length, "Assessment")} will stop selecting it: ${effects.assessments.join(", ")}.`
                  : "No Assessment selects it by name; Assessments of all Repositories leave it out from now on."}
              </li>
              <li>{effects.runs ? `The results of the ${countLabel(effects.runs, "Run")} that included it stay with those Runs.` : "No Run of an Assessment has included it."}</li>
              {effects.previews > 0 && <li>{`Its ${countLabel(effects.previews, "preview")} and their published files will be deleted, and their addresses will stop answering.`}</li>}
            </ul>
            <button type="button" {...buttonProps("secondary")} className={`${buttonProps("secondary").className} ${styles.wide}`} onClick={() => setStep(3)}>
              I have read and understand these effects
            </button>
          </div>
        )}

        {step === 3 && <div className={styles.dialogStep}>{confirmation}</div>}
      </dialog>
    </>
  );
}
