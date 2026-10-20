"use client";

import { useRef, useState } from "react";
import { buttonProps } from "@/components/ui/button-content";
import { CopyButton } from "@/components/ui/copy-button";
import { EmptyState } from "@/components/ui/empty-state";
import { Checkbox, FormNote, Select, TextArea, TextInput } from "@/components/ui/form";
import { Icon } from "@/components/ui/icon";
import { Tag } from "@/components/ui/tag";
import {
  CROSS_ORIGINS,
  type Experience,
  FETCH_PRIORITIES,
  LIMITS,
  REFERRER_POLICIES,
  SCRIPT_TYPES,
  SESSION_DIALOGS,
  type SessionDialog,
  landingUrl,
} from "@/lib/experience/document";
import { CONFIGURATION_SECTIONS } from "@/lib/experience/sections";
import { EditorPane } from "./editor-panes";
import { usePreviewPane } from "./parts";
import { useEditor } from "./store";
import styles from "./configuration.module.css";



const left = (max: number, value: string) => `${Math.max(0, max - value.length)} characters left`;

/** The sections whose fields change what the frame shows, with the overlays their preview opens. */
const PREVIEWED: Partial<Record<string, "none" | "all">> = { brand: "none", theme: "none", copyright: "none", "session-language": "all" };

/**
 * A configuration section's page (portal-configuration spec, "Configuration
 * sections are listed in groups"): titled in the header with the section's
 * name, its one-line description, its fields, and Reset to default; beside
 * them, the live preview when the section changes what the frame shows. The
 * Runtime Configuration sub-menu lists the sections.
 */
export function ConfigurationView({ section }: { section: string }) {
  const editor = useEditor();
  const current = CONFIGURATION_SECTIONS.find((candidate) => candidate.id === section) ?? CONFIGURATION_SECTIONS[0]!;
  const overlays = PREVIEWED[current.id];
  const preview = usePreviewPane(overlays ?? "none", "Changes show here before they're saved");
  return (
    <div className={styles.page} data-previewed={overlays ? "" : undefined}>
      <article className={styles.article} data-configuration-section={current.id}>
        <p className={styles.summary}>{current.description}</p>
        <SectionBody id={current.id} />
        <button
          type="button"
          {...buttonProps("tertiary", "sm")}
          className={`${buttonProps("tertiary", "sm").className} ${styles.reset}`}
          onClick={() =>
            editor.edit((draft) => {
              for (const key of current.reset) (draft as Record<string, unknown>)[key] = structuredClone(editor.defaults[key]);
              // The default experience has no menu or toolkits of its own: keep the Portal's.
            })
          }
        >
          {current.id === "session-language" ? "Reset to default session language" : "Reset to default"}
        </button>
      </article>
      {overlays && <EditorPane {...preview} label="Preview" />}
    </div>
  );
}

/** A section's heading: its name for assistive technology (the page header shows it), what it controls, and any control beside it. */
function Heading({ title, children, aside }: { title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <header className={styles.heading}>
      <h2 id="section-title" className="visually-hidden">
        {title}
      </h2>
      <div className={styles.headingRow}>
        <p className={styles.lede}>{children}</p>
        {aside}
      </div>
    </header>
  );
}

function SectionBody({ id }: { id: string }) {
  switch (id) {
    case "favicon":
      return <FaviconSection />;
    case "theme":
      return <ThemeSection />;
    case "copyright":
      return <CopyrightSection />;
    case "routing":
      return <RoutingSection />;
    case "session-language":
      return <SessionLanguageSection />;
    case "session":
      return <SessionPolicySection />;
    case "runtime-modules":
      return <RuntimeModulesSection />;
    case "crash-error":
      return <CrashErrorSection />;
    default:
      return <BrandSection />;
  }
}

function BrandSection() {
  const editor = useEditor();
  const { brand } = editor.present;
  return (
    <>
      <Heading title="Brand & identity">The header shows the J.P. Morgan logo, then the portal name. The logo is the same in every portal.</Heading>
      <div className={styles.brandPreview} data-brand-preview="">
        {/* The logo file as a mask in the text color, so it reads in the light and the dark theme alike. */}
        <span role="img" aria-label="J.P. Morgan" className={styles.logo} />
        <span className={styles.divider} aria-hidden="true" />
        <span>{brand.portalName || "Portal name"}</span>
      </div>
      <TextInput id="brand-name" label="Portal name" value={brand.portalName} maxLength={LIMITS.portalName} errors={editor.errorsAt("brand.portalName")} description={left(LIMITS.portalName, brand.portalName)} onChange={(event) => editor.edit((draft) => void (draft.brand.portalName = event.target.value), "brand.portalName")} onBlur={editor.seal} />
      <Checkbox id="brand-home" label="The logo links to the default landing path" checked={brand.logoLinksHome} onChange={(event) => editor.edit((draft) => void (draft.brand.logoLinksHome = event.target.checked))} />
    </>
  );
}

function FaviconSection() {
  const editor = useEditor();
  const { favicon } = editor.present;
  const errors = editor.errorsAt("favicon.dataUrl");
  return (
    <>
      <Heading title="Favicon" aside={<Checkbox id="favicon-enabled" label="Enabled" checked={favicon.enabled} onChange={(event) => editor.edit((draft) => void (draft.favicon.enabled = event.target.checked))} />}>
        Used by browser tabs, bookmarks, and the OS task chooser. When disabled, the host runtime leaves the favicon link out entirely and browsers fall back to their default tab icon.
      </Heading>
      <FormNote title="Guidelines">
        <ul className={styles.guidelines}>
          <li>
            <strong>SVG preferred.</strong> A single vector renders crisply at every resolution; PNG or ICO is the fallback.
          </li>
          <li>
            <strong>Square, padded.</strong> Leave about 6% margin inside the artwork: browsers crop tightly.
          </li>
          <li>
            <strong>High contrast.</strong> It must read against both light and dark browser chrome.
          </li>
          <li>
            <strong>One asset.</strong> 16, 32, and 64 px are sizes the browser derives from the same source.
          </li>
        </ul>
      </FormNote>
      <TextArea id="favicon-url" label="Favicon data URL" rows={3} value={favicon.dataUrl} disabled={!favicon.enabled} errors={errors} description="Paste a base64 data URI or URL-encoded SVG to inline the asset. Only data URLs are accepted, so the runtime never links to an address it can't reach." onChange={(event) => editor.edit((draft) => void (draft.favicon.dataUrl = event.target.value.trim()), "favicon.dataUrl")} onBlur={editor.seal} />
      {favicon.enabled && !errors && (
        <ul className={styles.favicons} aria-label="Favicon sizes">
          {[16, 32, 64].map((size) => (
            <li key={size}>
              {/* eslint-disable-next-line @next/next/no-img-element -- a data URL the operator entered */}
              <img src={favicon.dataUrl} alt={`Favicon at ${size} pixels`} style={{ width: size, height: size }} />
              <span>{size === 16 ? "Tab · 16px" : size === 32 ? "Hi-DPI · 32px" : "Large · 64px"}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function ThemeSection() {
  const editor = useEditor();
  const dialog = useRef<HTMLDialogElement>(null);
  const { theme } = editor.present;
  const themes = editor.catalogs.themes;
  const active = themes.find((candidate) => candidate.id === theme.id);
  const [version, setVersion] = useState(theme.version);
  return (
    <>
      <Heading title="Design Theme">
        Theme packs are maintained by each theme&apos;s owner. A Portal uses one, pinned to a published version for stability or tracking latest to pick up releases automatically. Default is the system fallback: always available, and the initial theme of every Portal.
      </Heading>
      <p data-active-theme="">
        <Tag sans>{`Currently active: ${active?.name ?? theme.id} @ ${theme.version}`}</Tag>
      </p>
      <table className={styles.table} aria-label="Theme packs">
        <thead>
          <tr>
            <th scope="col">Theme</th>
            <th scope="col">Owner</th>
            <th scope="col">Version</th>
            <th scope="col">Notes</th>
            <th scope="col">
              <span className="visually-hidden">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {themes.map((candidate) => {
            const isActive = candidate.id === theme.id;
            return (
              <tr key={candidate.id} data-active={isActive ? "" : undefined}>
                <td>
                  <label className={styles.radio}>
                    <input type="radio" name="theme" checked={isActive} onChange={() => editor.edit((draft) => void (draft.theme = { id: candidate.id, version: "latest" }))} />
                    <span>{candidate.name}</span>
                  </label>
                </td>
                <td>{candidate.owner}</td>
                <td className={styles.mono}>{isActive ? theme.version : "latest"}</td>
                <td className={styles.notes}>{candidate.notes}</td>
                <td>
                  <button
                    type="button"
                    {...buttonProps("tertiary", "sm", true)}
                    aria-label={`Configure ${candidate.name}`}
                    title={isActive ? `Configure ${candidate.name}` : `Make ${candidate.name} active to configure it`}
                    disabled={!isActive}
                    onClick={() => {
                      setVersion(theme.version);
                      dialog.current?.showModal();
                    }}
                  >
                    <Icon name="settings" />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <dialog ref={dialog} className={styles.dialog} aria-labelledby="theme-dialog-title">
        <h4 id="theme-dialog-title" className={styles.dialogTitle}>{`Configure ${active?.name ?? "theme"}`}</h4>
        <p className={styles.lede}>Pin a published version for stability, or track latest to pick up releases automatically.</p>
        <Select id="theme-version" label="Version" value={version} options={[{ value: "latest", label: "latest" }, ...(active?.versions ?? []).map((value) => ({ value, label: value }))]} onChange={(event) => setVersion(event.target.value)} />
        <div className={styles.dialogActions}>
          <button type="button" {...buttonProps("secondary")} onClick={() => dialog.current?.close()}>
            Cancel
          </button>
          <button
            type="button"
            {...buttonProps("primary")}
            onClick={() => {
              editor.edit((draft) => void (draft.theme.version = version));
              dialog.current?.close();
            }}
          >
            Use version
          </button>
        </div>
      </dialog>
    </>
  );
}

function CopyrightSection() {
  const editor = useEditor();
  const { copyright } = editor.present;
  return (
    <>
      <Heading title="Copyright Information">
        Controls the legal copy rendered by the Experience Frame footer&apos;s <strong>Primary Slot</strong>.
      </Heading>
      <TextArea id="copyright" label="Copyright information" rows={2} value={copyright} maxLength={LIMITS.copyright} errors={editor.errorsAt("copyright")} description={`Rendered by Footer Zone → Primary Slot in the Experience Frame preview. ${left(LIMITS.copyright, copyright)}.`} onChange={(event) => editor.edit((draft) => void (draft.copyright = event.target.value), "copyright")} onBlur={editor.seal} />
    </>
  );
}

function RoutingSection() {
  const editor = useEditor();
  const { routing, session } = editor.present;
  const url = landingUrl(routing);
  return (
    <>
      <Heading title="Routing configuration">
        Where the portal mounts on its host (<strong>base path</strong>), where a fresh session lands (<strong>default landing path</strong>), and how its URLs are shaped (<strong>routing mode</strong>).
      </Heading>
      <TextInput id="routing-base" label="Base path" mono value={routing.basePath} readOnly={routing.basePathLocked} maxLength={LIMITS.basePath} errors={editor.errorsAt("routing.basePath")} description={routing.basePathLocked ? "Locked: unlock it to change the base path." : left(LIMITS.basePath, routing.basePath)} onChange={(event) => editor.edit((draft) => void (draft.routing.basePath = event.target.value), "routing.basePath")} onBlur={editor.seal} />
      <p>
        <button type="button" {...buttonProps("secondary", "sm")} aria-pressed={routing.basePathLocked} onClick={() => editor.edit((draft) => void (draft.routing.basePathLocked = !draft.routing.basePathLocked))}>
          <Icon name="lock" size={14} />
          {routing.basePathLocked ? "Unlock base path" : "Lock base path"}
        </button>
      </p>
      <TextInput id="routing-landing" label="Default landing path" mono value={routing.landingPath} maxLength={LIMITS.landingPath} errors={editor.errorsAt("routing.landingPath")} description={left(LIMITS.landingPath, routing.landingPath)} onChange={(event) => editor.edit((draft) => void (draft.routing.landingPath = event.target.value), "routing.landingPath")} onBlur={editor.seal} />
      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>Routing mode</legend>
        <div className={styles.segmented}>
          {(["history", "hash"] as const).map((mode) => (
            <button key={mode} type="button" aria-pressed={routing.mode === mode} className={styles.segment} onClick={() => editor.edit((draft) => void (draft.routing.mode = mode))}>
              {mode === "history" ? "History (clean URLs)" : "Hash (#/route)"}
            </button>
          ))}
        </div>
      </fieldset>
      <Checkbox id="routing-remember" label="Remember last visited route on return" description="Returning users resume on their last route. The default landing path is the fallback when no last route is recorded. The same setting is in Session Policy." checked={session.rememberLastRoute} onChange={(event) => editor.edit((draft) => void (draft.session.rememberLastRoute = event.target.checked))} />
      <div className={styles.livePreview}>
        <p className={styles.caption}>Live preview</p>
        <p className={styles.url}>
          <code data-landing-url="">{url}</code>
          <CopyButton value={url} label="Copy the landing URL" />
        </p>
        <p className={styles.lede}>Every fresh session, and every click on the home logo, opens the URL above.</p>
      </div>
    </>
  );
}

const DIALOG_TEXT: Record<SessionDialog, { toggle: string; description: string; primary: string; secondary: string | null }> = {
  inactivity: { toggle: "Change session inactivity alert language", description: "The text shown when a session is about to expire because of inactivity.", primary: "Primary action label", secondary: "Secondary action label" },
  duplicate: { toggle: "Change duplicate session alert language", description: "The warning shown when the same user is signed in somewhere else.", primary: "Primary action label", secondary: "Secondary action label" },
  systemError: { toggle: "Change system error alert language", description: "The acknowledgement shown for platform-level outages or blocking errors.", primary: "Acknowledge action label", secondary: null },
};

function SessionLanguageSection() {
  const editor = useEditor();
  return (
    <>
      <Heading title="Default Session Language">
        Review and edit the default-language copy of the three <strong>Session Overlay</strong> dialogs: inactivity timeout, duplicate session, and system error alerts.
      </Heading>
      {SESSION_DIALOGS.map((dialog) => {
        const copy = editor.present.sessionLanguage[dialog];
        const text = DIALOG_TEXT[dialog];
        const path = `sessionLanguage.${dialog}`;
        const set = (field: "title" | "message" | "primary" | "secondary", value: string) => editor.edit((draft) => void (draft.sessionLanguage[dialog][field] = value), `${path}.${field}`);
        return (
          <section key={dialog} className={styles.group}>
            <Checkbox id={`${dialog}-custom`} label={text.toggle} description={text.description} checked={copy.custom} onChange={(event) => editor.edit((draft) => void (draft.sessionLanguage[dialog].custom = event.target.checked))} />
            {copy.custom && (
              <div className={styles.groupFields}>
                <TextInput id={`${dialog}-title`} label="Dialog title" value={copy.title} maxLength={LIMITS.dialogTitle} errors={editor.errorsAt(`${path}.title`)} onChange={(event) => set("title", event.target.value)} onBlur={editor.seal} />
                <TextArea id={`${dialog}-message`} label="Dialog message" rows={3} value={copy.message} maxLength={LIMITS.dialogMessage} errors={editor.errorsAt(`${path}.message`)} onChange={(event) => set("message", event.target.value)} onBlur={editor.seal} />
                <TextInput id={`${dialog}-primary`} label={text.primary} value={copy.primary} maxLength={LIMITS.dialogTitle} errors={editor.errorsAt(`${path}.primary`)} onChange={(event) => set("primary", event.target.value)} onBlur={editor.seal} />
                {text.secondary && <TextInput id={`${dialog}-secondary`} label={text.secondary} value={copy.secondary} maxLength={LIMITS.dialogTitle} errors={editor.errorsAt(`${path}.secondary`)} onChange={(event) => set("secondary", event.target.value)} onBlur={editor.seal} />}
              </div>
            )}
          </section>
        );
      })}
    </>
  );
}

function SessionPolicySection() {
  const editor = useEditor();
  const { session } = editor.present;
  return (
    <>
      <Heading title="Session Policy">
        Controls how the portal remembers user state across visits. The same remember-last-route setting also appears under <strong>Routing configuration</strong>, next to the default landing path.
      </Heading>
      <section className={styles.group}>
        <Checkbox id="session-remember" label="Remember last visited route on return" description="Returning users resume on their last route. The default landing path is the fallback when no last route is recorded." checked={session.rememberLastRoute} onChange={(event) => editor.edit((draft) => void (draft.session.rememberLastRoute = event.target.checked))} />
      </section>
      <section className={styles.group}>
        <Checkbox id="session-logout" label="Configure logout redirect URL" description="Sends the user to a custom URL after logout. Leave it off to inherit the platform's default post-logout flow." checked={session.logoutRedirect.enabled} onChange={(event) => editor.edit((draft) => void (draft.session.logoutRedirect.enabled = event.target.checked))} />
        {session.logoutRedirect.enabled && (
          <div className={styles.groupFields}>
            <TextInput id="session-logout-url" label="Logout redirect URL" mono placeholder="/login or https://sso.example.com" value={session.logoutRedirect.url} errors={editor.errorsAt("session.logoutRedirect.url")} onChange={(event) => editor.edit((draft) => void (draft.session.logoutRedirect.url = event.target.value), "session.logoutRedirect.url")} onBlur={editor.seal} />
          </div>
        )}
      </section>
    </>
  );
}

function RuntimeModulesSection() {
  const editor = useEditor();
  const { present, catalogs } = editor;
  const required = catalogs.toolkits.filter((toolkit) => present.toolkits.installed.includes(toolkit.id));
  const taken = new Set([...present.runtimeModules.map((module) => module.name), ...required.map((toolkit) => toolkit.module)]);
  const available = catalogs.modules.filter((module) => !taken.has(module.name));
  const [choice, setChoice] = useState("");
  const included = required.length + present.runtimeModules.length;
  return (
    <>
      <Heading title="Runtime modules">
        Federated modules the host injects into the runtime bootstrap. Add the modules that must be available up front, pin a version when needed, and tune operator-owned script attributes such as <code>type</code>, <code>async</code>, <code>defer</code>, <code>integrity</code>, <code>crossorigin</code>, <code>referrerpolicy</code>, and <code>fetchpriority</code>. The runtime still owns the script&apos;s <code>src</code> and CSP nonce.
      </Heading>
      <div className={styles.picker}>
        <Select id="module-pick" label="Module to include" hideLabel value={choice} options={[{ value: "", label: "Pick a module to include…" }, ...available.map((module) => ({ value: module.name, label: `${module.name} · ${module.description}` }))]} onChange={(event) => setChoice(event.target.value)} />
        <div className={styles.pickerRow}>
          <button
            type="button"
            {...buttonProps("secondary", "sm")}
            disabled={!choice}
            onClick={() => {
              editor.edit((draft) => void draft.runtimeModules.push({ name: choice, version: "latest", attributes: { type: "module", async: true, defer: false, integrity: "", crossorigin: "", referrerpolicy: "", fetchpriority: "auto" } }));
              setChoice("");
            }}
          >
            <Icon name="plus" size={14} />
            Include in runtime
          </button>
          <span className={styles.count} data-module-count="">{`${included} of ${catalogs.modules.length} modules`}</span>
        </div>
      </div>
      {included === 0 ? (
        <EmptyState title="No runtime modules included" icon="layers">
          The host loads every federated module on demand. Add a module above to make it part of the runtime bootstrap.
        </EmptyState>
      ) : (
        <ul className={styles.modules} aria-label="Included modules">
          {required.map((toolkit) => (
            <li key={toolkit.module} className={styles.module} data-module={toolkit.module}>
              <div className={styles.moduleHeader}>
                <code>{toolkit.module}</code>
                <Tag sans>{`Required by ${toolkit.name}`}</Tag>
                <span className={styles.mono}>latest</span>
              </div>
            </li>
          ))}
          {present.runtimeModules.map((module, index) => {
            const registered = catalogs.modules.find((candidate) => candidate.name === module.name);
            const path = `runtimeModules.${index}`;
            const set = (update: (draft: Experience["runtimeModules"][number]) => void, coalesce?: string) => editor.edit((draft) => update(draft.runtimeModules[index]!), coalesce);
            return (
              <li key={module.name} className={styles.module} data-module={module.name}>
                <div className={styles.moduleHeader}>
                  <code>{module.name}</code>
                  <button type="button" {...buttonProps("tertiary", "sm")} onClick={() => editor.edit((draft) => void draft.runtimeModules.splice(index, 1))} aria-label={`Remove ${module.name}`}>
                    Remove
                  </button>
                </div>
                <div className={styles.moduleFields}>
                  <Select id={`${path}-version`} label="Version" size="sm" value={module.version} errors={editor.errorsAt(`${path}.version`)} options={[{ value: "latest", label: "latest" }, ...(registered?.versions ?? []).map((value) => ({ value, label: value }))]} onChange={(event) => set((draft) => void (draft.version = event.target.value))} />
                  <Select id={`${path}-type`} label="type" size="sm" value={module.attributes.type} options={SCRIPT_TYPES.map((value) => ({ value, label: value }))} onChange={(event) => set((draft) => void (draft.attributes.type = event.target.value as (typeof SCRIPT_TYPES)[number]))} />
                  <Select id={`${path}-crossorigin`} label="crossorigin" size="sm" value={module.attributes.crossorigin} options={CROSS_ORIGINS.map((value) => ({ value, label: value || "(none)" }))} onChange={(event) => set((draft) => void (draft.attributes.crossorigin = event.target.value as (typeof CROSS_ORIGINS)[number]))} />
                  <Select id={`${path}-referrer`} label="referrerpolicy" size="sm" value={module.attributes.referrerpolicy} options={REFERRER_POLICIES.map((value) => ({ value, label: value || "(none)" }))} onChange={(event) => set((draft) => void (draft.attributes.referrerpolicy = event.target.value as (typeof REFERRER_POLICIES)[number]))} />
                  <Select id={`${path}-priority`} label="fetchpriority" size="sm" value={module.attributes.fetchpriority} options={FETCH_PRIORITIES.map((value) => ({ value, label: value }))} onChange={(event) => set((draft) => void (draft.attributes.fetchpriority = event.target.value as (typeof FETCH_PRIORITIES)[number]))} />
                  <TextInput id={`${path}-integrity`} label="integrity" mono size="sm" placeholder="sha384-…" value={module.attributes.integrity} errors={editor.errorsAt(`${path}.attributes.integrity`)} onChange={(event) => set((draft) => void (draft.attributes.integrity = event.target.value), `${path}.integrity`)} onBlur={editor.seal} />
                  <Checkbox id={`${path}-async`} label="async" checked={module.attributes.async} onChange={(event) => set((draft) => void (draft.attributes.async = event.target.checked))} />
                  <Checkbox id={`${path}-defer`} label="defer" checked={module.attributes.defer} onChange={(event) => set((draft) => void (draft.attributes.defer = event.target.checked))} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <p>
        <button type="button" {...buttonProps("tertiary", "sm")} disabled={present.runtimeModules.length === 0} onClick={() => editor.edit((draft) => void (draft.runtimeModules = []))}>
          Clear list
        </button>
      </p>
    </>
  );
}

function CrashErrorSection() {
  const editor = useEditor();
  const { crashError } = editor.present;
  const set = (field: keyof Experience["crashError"], value: string) => editor.edit((draft) => void (draft.crashError[field] = value), `crashError.${field}`);
  return (
    <>
      <Heading title="Crash Error">What the host renders when its error boundary trips. The primary action reloads the page; the support link, when given, follows it.</Heading>
      <TextInput id="crash-title" label="Title" value={crashError.title} maxLength={LIMITS.dialogTitle} errors={editor.errorsAt("crashError.title")} onChange={(event) => set("title", event.target.value)} onBlur={editor.seal} />
      <TextArea id="crash-message" label="Message" rows={3} value={crashError.message} maxLength={LIMITS.dialogMessage} errors={editor.errorsAt("crashError.message")} onChange={(event) => set("message", event.target.value)} onBlur={editor.seal} />
      <TextInput id="crash-action" label="Primary action label" value={crashError.action} maxLength={LIMITS.dialogTitle} errors={editor.errorsAt("crashError.action")} onChange={(event) => set("action", event.target.value)} onBlur={editor.seal} />
      <TextInput id="crash-support" label="Support link" optional mono placeholder="/support or https://help.example.com" value={crashError.supportUrl} errors={editor.errorsAt("crashError.supportUrl")} onChange={(event) => set("supportUrl", event.target.value)} onBlur={editor.seal} />
      <div className={styles.crashPreview} role="img" aria-label="Crash page preview" data-crash-preview="">
        <Icon name="alert" size={20} />
        <p className={styles.crashTitle}>{crashError.title}</p>
        <p className={styles.lede}>{crashError.message}</p>
        <p className={styles.crashActions}>
          <span className={styles.crashPrimary}>{crashError.action}</span>
          {crashError.supportUrl && <span className={styles.crashLink}>Get support</span>}
        </p>
      </div>
    </>
  );
}
