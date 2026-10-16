"use client";

import Link from "next/link";
import { useActionState, useState, useSyncExternalStore } from "react";
import { ButtonLink } from "@/components/ui/button";
import { buttonProps } from "@/components/ui/button-content";
import { FormAlert, FormFooter, Select, TextArea, TextInput, formStyles } from "@/components/ui/form";
import { Icon } from "@/components/ui/icon";
import { SplitPanes } from "@/components/ui/split-dialog";
import { SubmitButton } from "@/components/ui/submit-button";
import { Tag } from "@/components/ui/tag";
import { useFocusFirstInvalid } from "@/components/ui/use-focus-first-invalid";
import { GIT_PROVIDER_LABELS, detectProvider } from "@/lib/applications/repository-url";
import { APPLICATION_SLUG_MAX, deriveApplicationSlug } from "@/lib/applications/slug";
import type { CreateApplicationState } from "./create-state";
import styles from "./create.module.css";

const subscribeNever = () => () => {};

const text = (state: CreateApplicationState, field: string) => {
  const entry = state.values[field];
  return typeof entry === "string" ? entry : "";
};
const collapse = (value: string) => value.trim().replace(/\s+/g, " ");

export interface PortalChoice {
  publicId: string;
  label: string;
  lifecycle: string;
}

interface CreateApplicationFormProps {
  action: (previous: CreateApplicationState, formData: FormData) => Promise<CreateApplicationState>;
  initial: CreateApplicationState;
  portals: readonly PortalChoice[];
  bitbucketHosts: readonly string[];
  /** The chosen starter or template's slug, submitted with the form. */
  starter: string | null;
  cancelHref: string;
  /** The starter panel beside the form. */
  aside: React.ReactNode;
  asideTitle: string;
}

/** A field error that names another Application links to it. */
function ErrorLink({ link }: { link?: { href: string; label: string } }) {
  return link ? (
    <p className={styles.errorLink}>
      <Link href={link.href}>{link.label}</Link>
    </p>
  ) : null;
}

/**
 * The Create Application form (application-creation spec): SEAL ID, Name,
 * the slug the name derives with an Edit button, Description, Repository
 * URL with its detected provider, and Portal, with the starter's panel
 * beside it. The heading follows the name. Before JavaScript runs, the slug
 * is a plain optional field that the server derives when blank.
 */
export function CreateApplicationForm({ action, initial, portals, bitbucketHosts, starter, cancelHref, aside, asideTitle }: CreateApplicationFormProps) {
  const hydrated = useSyncExternalStore(subscribeNever, () => true, () => false);
  const [state, formAction] = useActionState(action, initial);
  const form = useFocusFirstInvalid(state, "create-application-alert");
  const [name, setName] = useState(text(state, "name"));
  const [slug, setSlug] = useState(text(state, "slug"));
  const [slugEdited, setSlugEdited] = useState(text(state, "slug") !== "" && text(state, "slug") !== deriveApplicationSlug(text(state, "name")));
  const [editingSlug, setEditingSlug] = useState(false);
  const [repository, setRepository] = useState(text(state, "repositoryUrl"));
  const [shownState, setShownState] = useState(state);

  // A refused submission comes back with what was entered; the client state follows it, and a slug problem opens the slug's field.
  if (shownState !== state) {
    setShownState(state);
    setName(text(state, "name"));
    setSlug(text(state, "slug"));
    setRepository(text(state, "repositoryUrl"));
    setSlugEdited(text(state, "slug") !== "" && text(state, "slug") !== deriveApplicationSlug(text(state, "name")));
    if (state.errors.slug) setEditingSlug(true);
  }

  const currentSlug = slugEdited ? slug : deriveApplicationSlug(name);
  const heading = collapse(name) ? `Create ${collapse(name)}` : "Create Application";
  const provider = repository ? detectProvider(repository, { bitbucketHosts, allowLocal: true }) : null;
  const portal = text(state, "portal");

  return (
    <form ref={form} action={formAction} noValidate className={styles.form}>
      <SplitPanes asideTitle={asideTitle} aside={aside} surface>
        <div className={styles.header}>
          <h1 className={styles.title}>{heading}</h1>
          <p className={styles.lede}>DE FabLab registers the repository, assesses it, and determines how DE Web will render it. It never writes to Bitbucket or GitHub.</p>
        </div>
        <div className={formStyles.form}>
          {state.errors.base && <FormAlert id="create-application-alert">{state.errors.base.join(" ")}</FormAlert>}
          {starter && <input type="hidden" name="starter" value={starter} />}
          <TextInput id="application-seal-id" name="sealId" label="SEAL ID" mono defaultValue={text(state, "sealId")} errors={state.errors.sealId} maxLength={64} required description="Metadata only: other Applications may carry the same SEAL ID." />
          <div className={styles.nameAndSlug}>
            <TextInput id="application-name" name="name" label="Name" value={name} onChange={(event) => setName(event.target.value)} errors={state.errors.name} maxLength={100} required description="Such as Payee Hub. You can change it later." />
            {!hydrated ? (
              <TextInput id="application-slug" name="slug" label="Slug" mono optional defaultValue={text(state, "slug")} errors={state.errors.slug} maxLength={APPLICATION_SLUG_MAX} description="Lowercase letters, digits, and hyphens, starting with a letter. Leave it blank to derive it from the name." />
            ) : editingSlug ? (
              <TextInput
                id="application-slug"
                name="slug"
                label="Slug"
                mono
                value={slug}
                onChange={(event) => setSlug(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, APPLICATION_SLUG_MAX))}
                errors={state.errors.slug}
                maxLength={APPLICATION_SLUG_MAX}
                description="Lowercase letters, digits, and single hyphens, starting with a letter. It's fixed once the Application is created."
              />
            ) : (
              <div className={styles.slug}>
                <input type="hidden" name="slug" value={currentSlug} />
                <span className={styles.slugLabel} id="application-slug-label">
                  Slug
                </span>
                {currentSlug ? (
                  <Tag>{currentSlug}</Tag>
                ) : (
                  <span className={styles.slugEmpty} aria-describedby="application-slug-label">
                    None yet
                  </span>
                )}
                <button
                  type="button"
                  id="application-slug-edit"
                  {...buttonProps("tertiary", "sm", true)}
                  aria-label="Edit slug"
                  title="Edit slug"
                  onClick={() => {
                    setSlug(currentSlug);
                    setSlugEdited(true);
                    setEditingSlug(true);
                    requestAnimationFrame(() => document.getElementById("application-slug")?.focus());
                  }}
                >
                  <Icon name="edit" size={14} />
                </button>
              </div>
            )}
            <ErrorLink link={state.links?.slug} />
          </div>
          <TextArea id="application-description" name="description" label="Description" defaultValue={text(state, "description")} errors={state.errors.description} maxLength={500} rows={3} required description="What the application does, in a sentence or two." />
          <div>
            <TextInput
              id="application-repository"
              name="repositoryUrl"
              label="Repository URL"
              mono
              inputMode="url"
              value={repository}
              onChange={(event) => setRepository(event.target.value)}
              errors={state.errors.repositoryUrl}
              maxLength={2000}
              required
              autoComplete="off"
              description="The HTTPS or SSH URL of its Bitbucket or GitHub repository. Leave credentials out; the host's credentials are configured for DE FabLab."
            />
            <p className={styles.provider} aria-live="polite">
              {provider && (
                <>
                  <Icon name={provider === "github" ? "github" : provider === "bitbucket" ? "bitbucket" : "folder"} />
                  {GIT_PROVIDER_LABELS[provider]}
                </>
              )}
            </p>
            <ErrorLink link={state.links?.repositoryUrl} />
          </div>
          {portals.length > 0 ? (
            <Select
              id="application-portal"
              name="portal"
              label="Portal"
              defaultValue={portal}
              errors={state.errors.portal}
              required
              description="The Portal whose menu can point at it. It's fixed once the Application is created."
              options={[{ value: "", label: "Choose a Portal" }, ...portals.map((choice) => ({ value: choice.publicId, label: `${choice.label} · ${choice.lifecycle}` }))]}
            />
          ) : (
            <div className={styles.noPortal}>
              <Select id="application-portal" name="portal" label="Portal" defaultValue="" errors={state.errors.portal} required description="Create a Portal first: an Application belongs to one." options={[{ value: "", label: "No Portals yet" }]} />
              <ButtonLink href="/navigation/new" variant="secondary" icon="plus" size="sm">
                Create Portal
              </ButtonLink>
            </div>
          )}
          <FormFooter>
            <ButtonLink href={cancelHref}>Cancel</ButtonLink>
            <SubmitButton pendingLabel="Creating">Create Application</SubmitButton>
          </FormFooter>
        </div>
      </SplitPanes>
    </form>
  );
}
