"use client";

import { useActionState, useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { DescriptionList } from "@/components/ui/description-list";
import { FormAlert, Select, TextArea, TextInput } from "@/components/ui/form";
import { PrototypeFrame } from "@/components/ui/prototype-frame";
import { SubmitButton } from "@/components/ui/submit-button";
import type { AcceptanceInput } from "@/lib/prototypes/templates";
import type { AcceptState } from "./actions";
import { ConformanceCheck } from "./conformance-check";
import styles from "./accept.module.css";

/** How long the hidden frame may take to capture the card image before accepting without one. */
const CAPTURE_TIMEOUT_MS = 20_000;

interface AcceptFlowProps {
  action: (previous: AcceptState, formData: FormData) => Promise<AcceptState>;
  initial: AcceptanceInput;
  brands: readonly { value: string; label: string }[];
  limits: { title: number; description: number; tags: number; tagLength: number; displayName: number };
  /** The version's evidence, rendered by the page, for the confirmation. */
  evidence: React.ReactNode;
  /** The frame's address at the capture's mode and density. */
  captureSrc: string;
  captureSize: { width: number; height: number };
  /** The template version this publishes, such as "Urgent payments queue v2", when the prototype already has a template. */
  updating: string | null;
  anonymous: string;
  versionId: string;
  /** Starts a new check of the version and returns its Run's id. */
  recheck: () => Promise<string | null>;
}

/**
 * The Accept flow's two steps: the template's details, then a confirmation
 * that summarizes them and the version's evidence while a hidden frame
 * captures the card image at the desktop size.
 */
export function AcceptFlow({ action, initial, brands, limits, evidence, captureSrc, captureSize, updating, anonymous, versionId, recheck }: AcceptFlowProps) {
  const [state, formAction] = useActionState(action, { values: initial, errors: {}, stage: "details" });
  // Back returns to the details for the confirmation it left; a new confirmation shows again.
  const [leftConfirmation, setLeftConfirmation] = useState<number | null>(null);
  const confirming = state.stage === "confirm" && leftConfirmation !== state.submission;
  const [image, setImage] = useState<string | null>(null);
  const [captureFailed, setCaptureFailed] = useState(false);
  // The check against Salt Patterns' Releases: the Run the confirmation submits, and whether it lets Accept be confirmed.
  const [check, setCheck] = useState<{ run: string | null; confirmable: boolean }>({ run: null, confirmable: false });
  const reportCheck = useCallback((run: string | null, confirmable: boolean) => setCheck({ run, confirmable }), []);

  useEffect(() => {
    if (!confirming || image) return;
    const timer = setTimeout(() => setCaptureFailed(true), CAPTURE_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [confirming, image]);

  const values = state.values;
  if (confirming) {
    const brand = brands.find((option) => option.value === values.brand)?.label ?? values.brand;
    return (
      <form action={formAction} className={styles.flow} data-accept-step="confirm">
        <h2 className={styles.step}>Confirm</h2>
        <p className={styles.muted}>{updating
            ? `Accepting publishes ${updating} to everyone on this deployment. Earlier versions stay in its history, unchanged, and a published version never changes.`
            : "Accepting publishes template version 1 to everyone on this deployment, in the Salt Patterns gallery, provided by Community and marked From Prototypes. A published version never changes."}</p>
        <DescriptionList
          items={[
            ["Title", values.title],
            ["Description", values.description],
            ["Brand", brand],
            ["Tags", values.tags.split(",").map((tag) => tag.trim()).filter(Boolean).join(", ")],
            ["Accepted by", values.displayName.trim() || anonymous],
          ]}
        />
        <div className={styles.evidence}>{evidence}</div>
        <section className={styles.check} aria-labelledby="accept-standards">
          <h3 id="accept-standards" className={styles.label}>
            Salt Patterns Standards
          </h3>
          <ConformanceCheck key={state.submission} versionId={versionId} run={state.run ?? null} recheck={recheck} onResult={reportCheck} />
        </section>
        {state.errors.base && <FormAlert id="accept-confirm-alert">{state.errors.base.join(" ")}</FormAlert>}
        <div className={styles.image}>
          <p className={styles.label}>Card image</p>
          {image ? (
            // A data URL the frame captured, shown before it is stored.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={image} alt={`${values.title}, as the gallery card will show it`} className={styles.thumb} data-capture="done" />
          ) : (
            <p className={styles.muted} role="status" data-capture={captureFailed ? "failed" : "running"}>
              {captureFailed ? "The card image couldn't be captured; the card will show a placeholder. You can accept a later version to capture one." : "Capturing the card image…"}
            </p>
          )}
        </div>
        {!image && !captureFailed && (
          <PrototypeFrame
            src={captureSrc}
            width={captureSize.width}
            height={captureSize.height}
            title={`${values.title}, card image capture`}
            hidden
            capture={{ token: state.submission ?? 1, ...captureSize }}
            onFrameMessage={(message) => {
              if (message.type === "capture-result") setImage(message.dataUrl);
              else if (message.type === "capture-error" || message.type === "render-error") setCaptureFailed(true);
            }}
          />
        )}
        {(Object.keys(values) as (keyof AcceptanceInput)[]).map((name) => (
          <input key={name} type="hidden" name={name} value={values[name]} />
        ))}
        <input type="hidden" name="stage" value="confirm" />
        <input type="hidden" name="preview" value={image ?? ""} />
        <input type="hidden" name="run" value={check.run ?? ""} />
        <div className={styles.actions}>
          <SubmitButton pendingLabel="Accepting" disabled={(!image && !captureFailed) || !check.confirmable}>
            {updating ? "Publish next version" : "Accept as template"}
          </SubmitButton>
          <Button type="button" variant="secondary" onClick={() => setLeftConfirmation(state.submission ?? null)}>
            Back
          </Button>
        </div>
      </form>
    );
  }

  return (
    <form action={formAction} className={styles.flow} noValidate data-accept-step="details">
      <h2 className={styles.step}>Details</h2>
      {state.errors.base && <FormAlert id="accept-alert">{state.errors.base.join(" ")}</FormAlert>}
      <TextInput id="accept-title" name="title" label="Title" defaultValue={values.title} errors={state.errors.title} maxLength={limits.title} required />
      <TextArea id="accept-description" name="description" label="Description" description="One or two sentences, shown on the gallery card." rows={3} defaultValue={values.description} errors={state.errors.description} maxLength={limits.description} required />
      <Select id="accept-brand" name="brand" label="Brand" defaultValue={values.brand} errors={state.errors.brand} options={brands} />
      <TextInput id="accept-tags" name="tags" label="Tags" description={`Separated by commas, up to ${limits.tags}.`} defaultValue={values.tags} errors={state.errors.tags} />
      <TextInput id="accept-display-name" name="displayName" label="Your display name" optional description={`Shown as who accepted it, and remembered for this workspace. Without one, it reads “${anonymous}”.`} defaultValue={values.displayName} errors={state.errors.displayName} maxLength={limits.displayName} />
      <input type="hidden" name="stage" value="details" />
      <div className={styles.actions}>
        <SubmitButton pendingLabel="Checking">Continue</SubmitButton>
      </div>
    </form>
  );
}
