"use client";

import { useRef, useState } from "react";
import { ButtonLink } from "@/components/ui/button";
import { buttonProps } from "@/components/ui/button-content";
import { Checkbox, TextInput } from "@/components/ui/form";
import { Icon } from "@/components/ui/icon";
import { SearchField } from "@/components/ui/search-field";
import { Tag } from "@/components/ui/tag";
import type { Toolkit } from "@/lib/experience/catalogs";
import { type Experience, LIMITS, isInstalled } from "@/lib/experience/document";
import { EditorPanes } from "./editor-panes";
import { NothingSelected, OptionsSection, usePreviewPane } from "./parts";
import { useEditor } from "./store";
import styles from "./views.module.css";
import capability from "./capabilities.module.css";

const SERVES_LABELS: Record<string, string> = {
  "header.global-search": "Header Zone → Global Search Slot",
  "header.notifications": "Header Zone → Notifications Slot",
  "banner.message": "Banner Zone → Message Slot",
  "sidebar.main": "Sidebar Zone → Main Slot",
  "overlay.session": "Session Overlay",
};

/** Whether +experience+ meets a prerequisite the editor can check; null for one it can only recommend. */
function prerequisiteMet(experience: Experience, check: string | undefined): boolean | null {
  if (check === "searchable-sources") return experience.toolkits.globalSearch.sources.some((source) => source.enabled);
  if (check === "menu-items") return experience.menu.some((node) => node.kind === "item");
  return null;
}

/**
 * The Capability Toolkit (capability-toolkits spec): optional toolkits, each
 * adding a runtime module to the portal and serving one zone or slot of the
 * frame. Installing is confirmed with the toolkit's prerequisites; removing
 * keeps its configuration for a later install. Both are pending changes.
 */
export function CapabilitiesView() {
  const editor = useEditor();
  const preview = usePreviewPane("none", "The preview shows what installed toolkits add");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const needle = query.trim().toLowerCase();
  const toolkits = editor.catalogs.toolkits.filter((toolkit) => !needle || toolkit.name.toLowerCase().includes(needle) || toolkit.description.toLowerCase().includes(needle));
  const current = editor.catalogs.toolkits.find((toolkit) => toolkit.id === selected) ?? null;
  return (
    <EditorPanes
      list={{
        title: "Capability Toolkit",
        children: (
          <div className={capability.list}>
            <p className={styles.optionsNote}>Use optional toolkits to extend your portal. Installing one adds its runtime module and unlocks the slot and configuration it serves.</p>
            <SearchField id="toolkit-search" label="Search capability toolkit" placeholder="Search by name or description" value={query} onChange={(event) => setQuery(event.target.value)} />
            <ul className={capability.toolkits} aria-label="Toolkits">
              {toolkits.map((toolkit) => {
                const installed = isInstalled(editor.present, toolkit.id);
                return (
                  <li key={toolkit.id} data-toolkit={toolkit.id}>
                    <button type="button" className={capability.toolkit} aria-current={selected === toolkit.id ? "true" : undefined} onClick={() => setSelected(toolkit.id)}>
                      <span className={capability.toolkitName}>{toolkit.name}</span>
                      <span className={capability.state} data-installed={installed ? "" : undefined}>
                        {installed && <Icon name="check" size={14} />}
                        {installed ? "Installed" : "Available"}
                      </span>
                    </button>
                  </li>
                );
              })}
              {toolkits.length === 0 && <li className={styles.optionsNote}>{`No toolkit matches “${query.trim()}”.`}</li>}
            </ul>
          </div>
        ),
      }}
      main={preview}
      options={{ title: "Options", children: current ? <ToolkitOptions toolkit={current} /> : <NothingSelected>Choose a toolkit from the list to see what it adds, install it, or configure it.</NothingSelected> }}
    />
  );
}

function ToolkitOptions({ toolkit }: { toolkit: Toolkit }) {
  const editor = useEditor();
  const install = useRef<HTMLDialogElement>(null);
  const remove = useRef<HTMLDialogElement>(null);
  const installed = isInstalled(editor.present, toolkit.id);
  const prerequisites = toolkit.prerequisites.map((prerequisite) => ({ ...prerequisite, met: prerequisiteMet(editor.present, prerequisite.check) }));
  const blocked = prerequisites.some((prerequisite) => prerequisite.required && prerequisite.met === false);
  const base = `/navigation/${editor.portal.publicId}/editor`;
  return (
    <div className={styles.options} data-toolkit-options={toolkit.id}>
      <div className={styles.optionsHeading}>
        <p className={styles.kicker}>Toolkit</p>
        <p className={styles.optionsTitle}>{toolkit.name}</p>
        <p className={styles.optionsNote}>{toolkit.description}</p>
      </div>
      <OptionsSection title="What it adds">
        <p className={styles.optionsNote}>{toolkit.adds}</p>
        <dl className={capability.facts}>
          <dt>Serves</dt>
          <dd>{SERVES_LABELS[toolkit.serves] ?? toolkit.serves}</dd>
          <dt>Runtime module</dt>
          <dd>
            <code>{toolkit.module}</code>
          </dd>
        </dl>
        {installed ? (
          <button type="button" {...buttonProps("secondary", "sm")} onClick={() => remove.current?.showModal()}>
            Remove
          </button>
        ) : (
          <button type="button" {...buttonProps("primary", "sm")} onClick={() => install.current?.showModal()}>
            Install
          </button>
        )}
      </OptionsSection>
      {installed && <ToolkitConfiguration toolkit={toolkit} base={base} />}

      <dialog ref={install} className={capability.dialog} aria-labelledby={`install-${toolkit.id}`}>
        <p className={styles.kicker}>One-click install</p>
        <h3 id={`install-${toolkit.id}`} className={capability.dialogTitle}>{`Install ${toolkit.name}`}</h3>
        <p className={styles.optionsNote}>{toolkit.adds}</p>
        <p className={capability.prerequisitesTitle}>Prerequisites</p>
        {prerequisites.length === 0 ? (
          <p className={styles.optionsNote}>None.</p>
        ) : (
          <ul className={capability.prerequisites} aria-label="Prerequisites">
            {prerequisites.map((prerequisite) => (
              <li key={prerequisite.text} data-met={prerequisite.met === null ? "recommended" : String(prerequisite.met)}>
                <Icon name={prerequisite.met === false ? "xCircle" : prerequisite.met ? "checkCircle" : "info"} size={14} label={prerequisite.met === false ? "Not met" : prerequisite.met ? "Met" : "Recommended"} />
                {prerequisite.text}
              </li>
            ))}
          </ul>
        )}
        {blocked && <p className={capability.blocked}>A required prerequisite isn&apos;t met yet.</p>}
        <div className={capability.dialogActions}>
          <button type="button" {...buttonProps("secondary")} onClick={() => install.current?.close()}>
            Cancel
          </button>
          <button
            type="button"
            {...buttonProps("primary")}
            disabled={blocked}
            onClick={() => {
              editor.edit((draft) => {
                if (!draft.toolkits.installed.includes(toolkit.id)) draft.toolkits.installed.push(toolkit.id);
                // Its slot shows once the toolkit is installed.
                const [zone, slot] = toolkit.serves.split(".") as [keyof Experience["frame"], string];
                const entry = draft.frame[zone]?.slots.find((candidate) => candidate.id === slot);
                if (entry) entry.visible = true;
              });
              install.current?.close();
            }}
          >
            Install
          </button>
        </div>
      </dialog>

      <dialog ref={remove} className={capability.dialog} aria-labelledby={`remove-${toolkit.id}`}>
        <h3 id={`remove-${toolkit.id}`} className={capability.dialogTitle}>{`Remove ${toolkit.name}?`}</h3>
        <p className={styles.optionsNote}>{`Its ${SERVES_LABELS[toolkit.serves] ?? "slot"} and its runtime module ${toolkit.module} are removed when you save. Its configuration is kept for a later install.`}</p>
        <div className={capability.dialogActions}>
          <button type="button" {...buttonProps("secondary")} autoFocus onClick={() => remove.current?.close()}>
            Cancel
          </button>
          <button
            type="button"
            {...buttonProps("danger")}
            onClick={() => {
              editor.edit((draft) => void (draft.toolkits.installed = draft.toolkits.installed.filter((id) => id !== toolkit.id)));
              remove.current?.close();
            }}
          >
            Remove toolkit
          </button>
        </div>
      </dialog>
    </div>
  );
}

function ToolkitConfiguration({ toolkit, base }: { toolkit: Toolkit; base: string }) {
  const editor = useEditor();
  const search = editor.present.toolkits.globalSearch;
  const notifications = editor.present.toolkits.notifications;
  if (toolkit.id === "global-search") {
    const moveSource = (index: number, by: -1 | 1) =>
      editor.edit((draft) => {
        const sources = draft.toolkits.globalSearch.sources;
        [sources[index], sources[index + by]] = [sources[index + by]!, sources[index]!];
      });
    return (
      <OptionsSection title="Configuration">
        <TextInput id="search-placeholder" label="Placeholder" value={search.placeholder} maxLength={40} errors={editor.errorsAt("toolkits.globalSearch.placeholder")} onChange={(event) => editor.edit((draft) => void (draft.toolkits.globalSearch.placeholder = event.target.value), "search.placeholder")} onBlur={editor.seal} />
        <TextInput id="search-shortcut" label="Keyboard shortcut" mono value={search.shortcut} maxLength={20} errors={editor.errorsAt("toolkits.globalSearch.shortcut")} description="A key, such as /, or a chord, such as ctrl+k." onChange={(event) => editor.edit((draft) => void (draft.toolkits.globalSearch.shortcut = event.target.value), "search.shortcut")} onBlur={editor.seal} />
        <TextInput id="search-width" label="Width (pixels)" type="number" inputMode="numeric" value={String(search.width)} errors={editor.errorsAt("toolkits.globalSearch.width")} description={`From ${LIMITS.searchWidthMin} to ${LIMITS.searchWidthMax}.`} onChange={(event) => editor.edit((draft) => void (draft.toolkits.globalSearch.width = Number.parseInt(event.target.value, 10) || 0), "search.width")} onBlur={editor.seal} />
        <fieldset className={capability.sources}>
          <legend className={capability.legend}>Data sources, in search order</legend>
          {editor.errorsAt("toolkits.globalSearch.sources") && <p className={capability.blocked}>{editor.errorsAt("toolkits.globalSearch.sources")!.join(" ")}</p>}
          <ul className={capability.sourceList} aria-label="Data sources">
            {search.sources.map((source, index) => (
              <li key={source.id} data-source={source.id}>
                <Checkbox id={`source-${source.id}`} label={source.label} checked={source.enabled} onChange={(event) => editor.edit((draft) => void (draft.toolkits.globalSearch.sources[index]!.enabled = event.target.checked))} />
                <span className={capability.sourceActions}>
                  <button type="button" {...buttonProps("tertiary", "sm", true)} aria-label={`Move ${source.label} up`} disabled={index === 0} onClick={() => moveSource(index, -1)}>
                    <Icon name="arrowUp" size={14} />
                  </button>
                  <button type="button" {...buttonProps("tertiary", "sm", true)} aria-label={`Move ${source.label} down`} disabled={index === search.sources.length - 1} onClick={() => moveSource(index, 1)}>
                    <Icon name="arrowDown" size={14} />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </fieldset>
      </OptionsSection>
    );
  }
  if (toolkit.id === "notifications") {
    return (
      <OptionsSection title="Configuration">
        <TextInput id="notifications-title" label="Panel title" value={notifications.title} maxLength={40} errors={editor.errorsAt("toolkits.notifications.title")} onChange={(event) => editor.edit((draft) => void (draft.toolkits.notifications.title = event.target.value), "notifications.title")} onBlur={editor.seal} />
        <Checkbox id="notifications-unread" label="Show the unread count" checked={notifications.showUnread} onChange={(event) => editor.edit((draft) => void (draft.toolkits.notifications.showUnread = event.target.checked))} />
      </OptionsSection>
    );
  }
  const link =
    toolkit.id === "system-messages"
      ? { href: `${base}/messages`, label: "Manage messages" }
      : toolkit.id === "menu-management"
        ? { href: `${base}/menu`, label: "Open menu editor" }
        : { href: `${base}/configuration/session-language`, label: "Edit session language" };
  return (
    <OptionsSection title="Configuration">
      <ButtonLink href={link.href} size="sm" icon="external">
        {link.label}
      </ButtonLink>
      {toolkit.id === "session-management" && (
        <ButtonLink href={`${base}/configuration/session`} size="sm" variant="tertiary">
          Edit session policy
        </ButtonLink>
      )}
      <Tag sans>Installed</Tag>
    </OptionsSection>
  );
}
