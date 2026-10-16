"use client";

import Link from "next/link";
import { useEffect, useId, useRef } from "react";
import { type ButtonSize, type ButtonVariant, ButtonContent, buttonProps } from "./button-content";
import { Icon, type IconName } from "./icon";
import styles from "./menu.module.css";

interface MenuProps {
  /** The trigger's accessible name, such as "Actions for orders". */
  label: string;
  /** Visible trigger text; without it the trigger is an icon button. */
  triggerText?: string;
  icon?: IconName;
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Which edge of the trigger the menu lines up with. */
  align?: "start" | "end";
  children: React.ReactNode;
}

/**
 * A list of actions in a popover. It uses the native popover attribute, so it
 * opens without JavaScript and renders above scrolling containers; CSS anchor
 * positioning places it, with a script fallback where that is unsupported.
 */
export function Menu({ label, triggerText, icon = "more", variant = "tertiary", size = "sm", align = "end", children }: MenuProps) {
  const id = useId().replace(/[^A-Za-z0-9_-]/g, "");
  const popover = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const element = popover.current;
    if (!element || CSS.supports("position-area: bottom")) return;
    // Without anchor positioning, place the menu below its trigger by measurement.
    const place = (event: Event) => {
      if ((event as ToggleEvent).newState !== "open" || !trigger.current) return;
      const rect = trigger.current.getBoundingClientRect();
      element.style.top = `${rect.bottom + 4}px`;
      element.style.left = `${align === "end" ? Math.max(8, rect.right - element.offsetWidth) : rect.left}px`;
    };
    element.addEventListener("toggle", place);
    return () => element.removeEventListener("toggle", place);
  }, [align]);

  return (
    <>
      <button
        ref={trigger}
        type="button"
        popoverTarget={`menu-${id}`}
        {...buttonProps(variant, size, !triggerText)}
        aria-label={triggerText ? undefined : label}
        title={triggerText ? undefined : label}
        style={{ anchorName: `--menu-${id}` } as React.CSSProperties}
      >
        <ButtonContent icon={triggerText ? undefined : icon} size={size}>
          {triggerText}
        </ButtonContent>
        {triggerText && <Icon name="chevronDown" size={14} />}
      </button>
      <div
        ref={popover}
        id={`menu-${id}`}
        popover="auto"
        className={styles.menu}
        data-align={align}
        style={{ positionAnchor: `--menu-${id}` } as React.CSSProperties}
        // Choosing an item closes the menu, including when the page stays the same.
        onClick={(event) => {
          if ((event.target as HTMLElement).closest("a, button")) popover.current?.hidePopover();
        }}
      >
        <div className={styles.list}>{children}</div>
      </div>
    </>
  );
}

/** A menu item that navigates; `newTab` opens the page in a new browser tab. */
export function MenuItem({ href, icon, newTab = false, children }: { href: string; icon?: IconName; newTab?: boolean; children: React.ReactNode }) {
  return (
    <Link href={href} className={styles.item} {...(newTab && { target: "_blank", rel: "noopener" })}>
      {icon && <Icon name={icon} size={14} />}
      {children}
      {newTab && <span className="visually-hidden"> (opens in a new tab)</span>}
    </Link>
  );
}

/** A menu item that submits a Server Action through its own form; works without JavaScript. */
export function MenuAction({ action, fields = {}, icon, tone = "default", children }: { action: (formData: FormData) => void | Promise<void>; fields?: Record<string, string>; icon?: IconName; tone?: "default" | "danger"; children: React.ReactNode }) {
  return (
    <form action={action} className={styles.form}>
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <button type="submit" className={styles.item} data-tone={tone}>
        {icon && <Icon name={icon} size={14} />}
        {children}
      </button>
    </form>
  );
}

/**
 * A menu item that runs client code; with `submit`, it submits its form
 * instead, as before JavaScript runs. With `formAction`, it submits the form
 * the menu sits in to that Server Action, with the form's fields, so a menu
 * inside a form, such as a `ConfirmDialog`'s, can hold other actions on the
 * same record without nesting forms.
 */
export function MenuButton({
  onClick,
  icon,
  disabled,
  tone = "default",
  submit = false,
  formAction,
  children,
}: {
  onClick?: () => void;
  icon?: IconName;
  disabled?: boolean;
  tone?: "default" | "danger";
  submit?: boolean;
  formAction?: (formData: FormData) => void | Promise<void>;
  children: React.ReactNode;
}) {
  return (
    <button type={submit || formAction ? "submit" : "button"} formAction={formAction} className={styles.item} data-tone={tone} onClick={onClick} disabled={disabled}>
      {icon && <Icon name={icon} size={14} />}
      {children}
    </button>
  );
}

export function MenuSeparator() {
  return <hr className={styles.separator} />;
}
