"use client";

import { SaltProviderNext } from "@salt-ds/core";
import { useEffect, useId, useRef, useState } from "react";
import { BRANDS } from "@/lib/demo/catalog";
import { Icon, type IconName } from "./members/icons";
import { useEmbedded, useProfile, useRuntime, useViewState } from "./runtime-context";
import styles from "./shell-parts.module.css";

/** Pieces both portal shells share: the portal root, header menus, and the user menu. */

export const ENVIRONMENT_LABELS = {
  production: "Production",
  sandbox: "Sandbox",
  dev: "Dev",
} as const;

export function initials(name: string): string {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2);
}

/**
 * The portal's root element. It identifies the application to the toolbar
 * (the audit root, the view key, the theme) and carries the shell's palette.
 * Salt's theme applies to it and everything inside, in the view's mode, so
 * generated Salt members render as Salt, and nothing outside the portal
 * changes (converge-templates-and-prototypes, design decision 11).
 */
export function PortalRoot({ className, children }: { className?: string; children: React.ReactNode }) {
  const { descriptor, template } = useRuntime();
  const { theme } = useViewState();
  const embedded = useEmbedded();
  return (
    <SaltProviderNext applyClassesTo="child" mode={theme} density="medium" accent="teal" corner="rounded">
      <div
        className={className}
        data-demo-portal=""
        data-brand={template.brand}
        data-shell={BRANDS[template.brand].shell}
        data-theme={theme}
        data-demo-app-root=""
        data-demo-view-key={descriptor.viewKey}
        data-demo-embedded={embedded || undefined}
      >
        {children}
      </div>
    </SaltProviderNext>
  );
}

/**
 * A header control that opens a small menu below it. Escape or a click
 * elsewhere closes it, and focus returns to the control.
 */
export function HeaderMenu({
  label,
  icon,
  trigger,
  align = "end",
  tone = "header",
  children,
}: {
  label: string;
  icon?: IconName;
  trigger?: React.ReactNode;
  align?: "start" | "end";
  tone?: "header" | "dark";
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  return (
    <div
      ref={root}
      className={styles.menuRoot}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          // The toolbar also closes its panel on Escape; this Escape belongs to the menu.
          event.stopPropagation();
          setOpen(false);
          button.current?.focus();
        }
      }}
    >
      <button
        ref={button}
        type="button"
        className={[trigger ? styles.triggerWide : styles.iconButton, tone === "dark" && styles.onDark].filter(Boolean).join(" ")}
        aria-label={trigger ? undefined : label}
        title={trigger ? undefined : label}
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        {trigger ?? (icon && <Icon name={icon} size={18} />)}
      </button>
      {open && (
        <div id={menuId} className={[styles.menu, align === "start" ? styles.alignStart : styles.alignEnd].join(" ")} role="region" aria-label={label}>
          {children}
        </div>
      )}
    </div>
  );
}

/** Menu content: a short list of entries, which are informational in the demo. */
export function MenuList({ title, items }: { title: string; items: readonly { primary: string; secondary?: string; current?: boolean }[] }) {
  return (
    <>
      <p className={styles.menuTitle}>{title}</p>
      <ul className={styles.menuList}>
        {items.map((item) => (
          <li key={item.primary} className={styles.menuItem} aria-current={item.current ? "true" : undefined}>
            <span>{item.primary}</span>
            {item.secondary && <span className={styles.menuSecondary}>{item.secondary}</span>}
          </li>
        ))}
      </ul>
    </>
  );
}

/** The user menu at the right end of the header: the active session profile, with its persona and region. */
export function UserMenu({ tone = "header" }: { tone?: "header" | "dark" }) {
  const profile = useProfile();
  return (
    <div className={styles.session} data-demo-anchor="portal-session">
      <HeaderMenu
        label={`User menu for ${profile.name}`}
        tone={tone}
        trigger={
          <>
            <span className={styles.avatar} aria-hidden="true">
              {initials(profile.name)}
            </span>
            <span className={styles.sessionText}>
              <span className={styles.personaName} title={profile.name}>
                {profile.name}
              </span>
              <span className={styles.personaRole}>{`${profile.persona} · ${profile.region}`}</span>
            </span>
            <Icon name="chevronDown" size={14} />
          </>
        }
      >
        <p className={styles.menuTitle}>{profile.name}</p>
        <p className={styles.menuSecondary}>{`${profile.persona} · ${profile.region}`}</p>
        <p className={styles.menuNote}>The profile comes from the session context. Change it in the toolbar&apos;s Session tool.</p>
      </HeaderMenu>
    </div>
  );
}

/** Search, notifications, and help: header actions with demo content. */
export function HeaderActions({ tone = "header", portal }: { tone?: "header" | "dark"; portal: string }) {
  return (
    <>
      <HeaderMenu label="Search" icon="search" tone={tone}>
        <MenuList
          title={`Search ${portal}`}
          items={[
            {
              primary: "Search is not part of the demo",
              secondary: "Use the application's own filters instead.",
            },
          ]}
        />
      </HeaderMenu>
      <HeaderMenu label="Notifications" icon="bell" tone={tone}>
        <MenuList
          title="Notifications"
          items={[
            { primary: "Two payments need approval", secondary: "Today, 9:40" },
            {
              primary: "September statements are ready",
              secondary: "Yesterday",
            },
          ]}
        />
      </HeaderMenu>
      <HeaderMenu label="Help" icon="help" tone={tone}>
        <MenuList
          title="Help"
          items={[
            { primary: "Support Hub", secondary: "Guides and contacts" },
            {
              primary: "Keyboard shortcuts",
              secondary: "Press ? with the toolbar open",
            },
          ]}
        />
      </HeaderMenu>
    </>
  );
}
