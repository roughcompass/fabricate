"use client";

import { usePathname } from "next/navigation";
import { useActionState, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { ButtonLink } from "@/components/ui/button";
import { buttonProps } from "@/components/ui/button-content";
import { CheckList } from "@/components/ui/check-list";
import { ChoiceGroup, FormAlert, FormFooter, TextArea, TextInput, formStyles } from "@/components/ui/form";
import { Icon } from "@/components/ui/icon";
import { SplitPanes, splitDialogClass } from "@/components/ui/split-dialog";
import { SubmitButton } from "@/components/ui/submit-button";
import { Tag } from "@/components/ui/tag";
import { useFocusFirstInvalid } from "@/components/ui/use-focus-first-invalid";
import { SLUG_MAX, deriveSlug, slugCharacters } from "@/lib/onboarding/slug";
import { PORTAL_PLATFORMS, PORTAL_PLATFORM_DESCRIPTIONS, PORTAL_PLATFORM_LABELS, type PortalPlatform } from "@/lib/onboarding/vocabulary";
import { itemsFor } from "@/lib/onboarding/whats-included-items";
import type { WhatsIncluded } from "@/lib/onboarding/whats-included";
import { onOpenCreatePortal, openCreatePortal } from "./create-portal-events";
import type { DialogAction, DialogState } from "./form-dialog";
import styles from "./create-portal.module.css";

const subscribeNever = () => () => {};
const PLATFORM_ICONS = { web: "globe", mobile: "smartphone", desktop: "monitor" } as const;

const text = (state: DialogState, field: string) => {
  const entry = state.values[field];
  return typeof entry === "string" ? entry : "";
};
const platformOf = (value: string): PortalPlatform | null => PORTAL_PLATFORMS.find((platform) => platform === value) ?? null;
const collapse = (value: string) => value.trim().replace(/\s+/g, " ");

interface CreatePortalFormProps {
  action: DialogAction;
  /** The "What's included" content, or null to show the form alone. */
  included: WhatsIncluded | null;
  mode: "dialog" | "page";
  /** Closes the dialog, in dialog mode. */
  onCancel?: () => void;
  /** The dialog's heading id, which names it. */
  titleId?: string;
}

/**
 * The Create Portal form beside What's included (portal-creation spec): the
 * platform as choice cards with none chosen, the SEAL ID, name, owning team,
 * and description, and the slug the name derives, shown with an edit button.
 * The heading follows the name and a tag names the platform. It doesn't ask
 * who's creating the Portal; the action records the remembered name. Before
 * JavaScript runs, the slug is a plain optional field that the server
 * derives when blank.
 */
export function CreatePortalForm({ action, included, mode, onCancel, titleId }: CreatePortalFormProps) {
  const hydrated = useSyncExternalStore(subscribeNever, () => true, () => false);
  const [state, formAction] = useActionState(action, { values: {}, errors: {} });
  const form = useFocusFirstInvalid(state, mode === "dialog" ? "create-portal-dialog-alert" : "create-portal-alert");
  const [name, setName] = useState(text(state, "name"));
  const [platform, setPlatform] = useState<PortalPlatform | null>(platformOf(text(state, "platform")));
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [editingSlug, setEditingSlug] = useState(false);
  const caret = useRef<number | null>(null);
  const [shownState, setShownState] = useState(state);
  const fallbackTitleId = useId();
  // The dialog shares pages with other forms, so its fields take prefixed ids; the page's form keeps the plain ones.
  const id = (field: string) => (mode === "dialog" ? `create-portal-${field}` : field);

  // A refused submission comes back with what was entered; the client state follows it, and a slug problem opens the slug's field.
  if (shownState !== state) {
    setShownState(state);
    const submittedName = text(state, "name");
    const submittedSlug = text(state, "slug");
    setName(submittedName);
    setPlatform(platformOf(text(state, "platform")));
    setSlug(submittedSlug);
    setSlugEdited(submittedSlug !== "" && submittedSlug !== deriveSlug(submittedName));
    if (state.errors.slug) setEditingSlug(true);
  }

  // Keeps the caret where it was when typing removed characters from the slug.
  const slugId = id("slug");
  useEffect(() => {
    const input = document.getElementById(slugId);
    if (caret.current === null || !(input instanceof HTMLInputElement)) return;
    input.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  }, [slug, slugId]);

  const currentSlug = slugEdited ? slug : deriveSlug(name);
  const heading = collapse(name) ? `Create ${collapse(name)}` : "Create a Portal";
  const items = included ? itemsFor(included.items, platform) : [];

  const editSlug = () => {
    setSlug(currentSlug);
    setSlugEdited(true);
    setEditingSlug(true);
    requestAnimationFrame(() => document.getElementById(id("slug"))?.focus());
  };
  const typeSlug = (event: React.ChangeEvent<HTMLInputElement>) => {
    const raw = event.target.value;
    const position = event.target.selectionStart ?? raw.length;
    const next = slugCharacters(raw).slice(0, SLUG_MAX);
    if (next !== raw) caret.current = Math.min(slugCharacters(raw.slice(0, position)).length, next.length);
    setSlug(next);
  };

  const cancel =
    mode === "dialog" ? (
      <button type="button" {...buttonProps("secondary")} onClick={onCancel}>
        Cancel
      </button>
    ) : (
      <ButtonLink href="/navigation">Cancel</ButtonLink>
    );

  const aside = included && items.length > 0 ? <CheckList label={included.title} items={items} link={included.link} /> : undefined;

  return (
    <form ref={form} action={formAction} noValidate className={styles.form}>
      <SplitPanes asideTitle={included?.title ?? "What's included"} aside={aside} surface={mode === "page"}>
        <div className={styles.header}>
          <span className={styles.platform}>{platform && <Tag sans>{PORTAL_PLATFORM_LABELS[platform]}</Tag>}</span>
          <h2 id={titleId ?? fallbackTitleId} className={styles.title}>
            {heading}
          </h2>
          <p className={styles.lede}>A Portal is configuration its team owns: its menu, its default route, and whether it&apos;s a Prototype or in Production. It owns no code.</p>
        </div>
        <div className={formStyles.form}>
          {state.errors.base && <FormAlert id={mode === "dialog" ? "create-portal-dialog-alert" : "create-portal-alert"}>{state.errors.base.join(" ")}</FormAlert>}
          <ChoiceGroup
            id={id("platform")}
            name="platform"
            legend="Platform"
            type="radio"
            columns
            selected={platform ? [platform] : []}
            errors={state.errors.platform}
            description="What the Portal targets. It's fixed once the Portal is created."
            choices={PORTAL_PLATFORMS.map((value) => ({ value, label: PORTAL_PLATFORM_LABELS[value], description: PORTAL_PLATFORM_DESCRIPTIONS[value], icon: PLATFORM_ICONS[value] }))}
            onChange={(event) => setPlatform(platformOf(event.target.value))}
          />
          <TextInput id={id("sealId")} name="sealId" label="SEAL ID" mono defaultValue={text(state, "sealId")} errors={state.errors.sealId} maxLength={64} required description="Metadata only: other Portals, Applications, and MFEs may carry the same SEAL ID." />
          <div className={styles.nameAndSlug}>
            <TextInput
              id={id("name")}
              name="name"
              label="Name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              errors={state.errors.name}
              maxLength={100}
              required
              description="Such as Access or Markets. You can change it later."
            />
            {!hydrated ? (
              <TextInput id={id("slug")} name="slug" label="Slug" mono optional defaultValue={text(state, "slug")} errors={state.errors.slug} maxLength={SLUG_MAX} description="Lowercase letters only, a to z. Leave it blank to derive it from the name." />
            ) : editingSlug ? (
              <TextInput
                id={id("slug")}
                name="slug"
                label="Slug"
                mono
                value={slug}
                onChange={typeSlug}
                errors={state.errors.slug}
                maxLength={SLUG_MAX}
                description="Lowercase letters only, a to z: no digits, spaces, or other characters. It's fixed once the Portal is created."
              />
            ) : (
              <div className={styles.slug}>
                <input type="hidden" name="slug" value={currentSlug} />
                <span className={styles.slugLabel} id={id("slug-label")}>
                  Slug
                </span>
                {currentSlug ? (
                  <Tag>{currentSlug}</Tag>
                ) : (
                  <span className={styles.slugEmpty} aria-describedby={id("slug-label")}>
                    None yet
                  </span>
                )}
                <button type="button" {...buttonProps("tertiary", "sm", true)} aria-label="Edit slug" title="Edit slug" onClick={editSlug}>
                  <Icon name="edit" size={14} />
                </button>
              </div>
            )}
          </div>
          <TextInput id={id("ownerTeam")} name="ownerTeam" label="Owning team" defaultValue={text(state, "ownerTeam")} errors={state.errors.ownerTeam} maxLength={100} required description="The team that owns the Portal and arranges its menu." />
          <TextArea id={id("description")} name="description" label="Description" defaultValue={text(state, "description")} errors={state.errors.description} maxLength={500} rows={3} required description="What the Portal is for, in a sentence or two." />
          <FormFooter>
            {cancel}
            <SubmitButton pendingLabel="Creating">Create Portal</SubmitButton>
          </FormFooter>
        </div>
      </SplitPanes>
    </form>
  );
}

/**
 * The Create Portal dialog, mounted once in the shell while Applications is
 * shown. Openers ask for it through openCreatePortal(). Escape, Cancel, and
 * the close button close it without creating anything, and focus returns to
 * the opener. Creating a Portal navigates to its Navigation page, which
 * closes it and starts the next one empty.
 */
export function CreatePortalDialog({ action, included }: { action: DialogAction; included: WhatsIncluded | null }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const pathname = usePathname();
  const [generation, setGeneration] = useState(0);
  const [shownFor, setShownFor] = useState(pathname);
  // A navigation, such as to a created Portal's Navigation page, starts the next form empty...
  if (shownFor !== pathname) {
    setShownFor(pathname);
    setGeneration((value) => value + 1);
  }

  // The form renders once the dialog first opens, so a page never carries a second copy of its fields.
  const [requested, setRequested] = useState(0);
  useEffect(
    () =>
      onOpenCreatePortal(() => {
        opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        setRequested((count) => count + 1);
      }),
    [],
  );
  useEffect(() => {
    if (!requested || !dialog.current || dialog.current.open) return;
    dialog.current.showModal();
    dialog.current.querySelector<HTMLInputElement>('input[name="platform"]')?.focus();
  }, [requested]);

  // ...and closes the dialog.
  useEffect(() => {
    if (!dialog.current?.open) return;
    opener.current = null;
    dialog.current.close();
  }, [pathname]);

  const close = () => dialog.current?.close();
  const closeButton = buttonProps("tertiary", "sm", true);
  return (
    <dialog ref={dialog} className={splitDialogClass} aria-labelledby={titleId} onClose={() => opener.current?.isConnected && opener.current.focus()}>
      <button type="button" {...closeButton} className={`${closeButton.className} ${styles.close}`} aria-label="Close" title="Close" onClick={close}>
        <Icon name="x" />
      </button>
      {requested > 0 && <CreatePortalForm key={generation} action={action} included={included} mode="dialog" onCancel={close} titleId={titleId} />}
    </dialog>
  );
}

/** New Portal: opens the Create Portal dialog, or the New Portal page before JavaScript runs or where no dialog is mounted. */
export function NewPortalLink({ children = "New Portal", variant = "primary" }: { children?: React.ReactNode; variant?: "primary" | "secondary" }) {
  // Until it hydrates, it's a plain link to the page, so only then does it announce a dialog.
  const hydrated = useSyncExternalStore(subscribeNever, () => true, () => false);
  return (
    <ButtonLink
      href="/navigation/new"
      variant={variant}
      icon="plus"
      aria-haspopup={hydrated ? "dialog" : undefined}
      onClick={(event) => {
        if (openCreatePortal()) event.preventDefault();
      }}
    >
      {children}
    </ButtonLink>
  );
}
