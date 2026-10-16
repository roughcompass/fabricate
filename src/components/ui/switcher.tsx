"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { Icon, type IconName } from "./icon";
import { Tag } from "./tag";
import styles from "./menu.module.css";

const subscribeNever = () => () => {};

export interface SwitcherOption {
  value: string;
  label: string;
  /** A tag after the label, such as a platform. */
  tag?: string | null;
  /** An icon in place of the label's initial, such as for an "all" option. */
  icon?: IconName;
  /** More text the filter matches, such as a slug or SEAL ID. */
  terms?: readonly (string | null)[];
}

interface SwitcherProps {
  /** What the switcher chooses, such as "Switch Portal"; the trigger's accessible name adds the current choice. */
  label: string;
  /** Always listed first and never filtered out, such as "All Portals". */
  pinned: SwitcherOption;
  options: readonly SwitcherOption[];
  /** The current option's value; the pinned option's when nothing else is chosen. */
  current: string;
  /** Chooses an option: each one submits its value as +field+, so choosing works without JavaScript. */
  action: (formData: FormData) => void | Promise<void>;
  field: string;
  searchLabel: string;
  /** Shown in place of the options when there are none. */
  empty: string;
  /** Shown, followed by the filter text in quotes, when the filter matches no option, such as "No Portal matches". */
  noMatch: string;
  /** The action that ends the list: a link before JavaScript runs, and after it, +onChoose+ when given, which opens a dialog in place; the link is followed if +onChoose+ returns false. */
  footer: { label: string; description: string; icon: IconName; href: string; onChoose?: () => boolean | void };
  /** Runs after any choice, such as closing a drawer. */
  onChosen?: () => void;
  /** Renders the open list in place, without the trigger or popover, for the design-system gallery. */
  preview?: boolean;
}

const initial = (label: string) => label.trim().charAt(0).toUpperCase() || "?";

function Avatar({ option }: { option: SwitcherOption }) {
  return <span className={styles.avatar} aria-hidden="true">{option.icon ? <Icon name={option.icon} size={12} /> : initial(option.label)}</span>;
}

/**
 * A context switcher (design-system docs, "Switcher"): a trigger showing the
 * current choice, opening a popover with a filter, the options with the
 * current one checked, and an action that ends the list. It uses the native
 * popover attribute, so it opens without JavaScript, and each option is a
 * form, so choosing works without JavaScript too; the filter and arrow-key
 * movement need it. Escape and an outside click close it.
 */
export function Switcher({ label, pinned, options, current, action, field, searchLabel, empty, noMatch, footer, onChosen, preview = false }: SwitcherProps) {
  const hydrated = useSyncExternalStore(subscribeNever, () => true, () => false);
  const id = useId().replace(/[^A-Za-z0-9_-]/g, "");
  const popover = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const selected = [pinned, ...options].find((option) => option.value === current) ?? pinned;

  useEffect(() => {
    const element = popover.current;
    if (!element || preview) return;
    const onToggle = (event: Event) => {
      if ((event as ToggleEvent).newState !== "open") return setQuery("");
      // Without anchor positioning, place the list below its trigger by measurement.
      if (!CSS.supports("position-area: bottom") && trigger.current) {
        const rect = trigger.current.getBoundingClientRect();
        element.style.top = `${rect.bottom + 4}px`;
        element.style.left = `${rect.left}px`;
      }
      search.current?.focus();
    };
    element.addEventListener("toggle", onToggle);
    return () => element.removeEventListener("toggle", onToggle);
  }, [preview]);

  const needle = query.trim().toLowerCase();
  const matches = (option: SwitcherOption) => !needle || [option.label, ...(option.terms ?? [])].some((term) => term?.toLowerCase().includes(needle));
  const shown = options.filter(matches);

  const close = () => popover.current?.hidePopover?.();
  // Up and Down move between the entries and the footer action; Down from the filter enters the list.
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const entries = [...event.currentTarget.querySelectorAll<HTMLElement>("[data-switcher-entry]")];
    if (!entries.length) return;
    event.preventDefault();
    const at = entries.indexOf(document.activeElement as HTMLElement);
    const next = event.key === "ArrowDown" ? (at + 1) % entries.length : at <= 0 ? entries.length - 1 : at - 1;
    entries[next]!.focus();
  };

  const entry = (option: SwitcherOption) => {
    const chosen = option.value === selected.value;
    return (
      <li key={option.value || "pinned"}>
        <form action={action} className={styles.form} onSubmit={() => queueMicrotask(() => (close(), onChosen?.()))}>
          <input type="hidden" name={field} value={option.value} />
          <button type="submit" className={`${styles.item} ${styles.entry}`} aria-current={chosen ? "true" : undefined} data-switcher-entry="">
            <Avatar option={option} />
            <span className={styles.entryLabel}>{option.label}</span>
            {option.tag && <Tag sans>{option.tag}</Tag>}
            {chosen && <Icon name="check" className={styles.entryCheck} label="Current" />}
          </button>
        </form>
      </li>
    );
  };

  const panel = (
    <div className={styles.switcherBody} onKeyDown={onKeyDown}>
      {(hydrated || preview) && (
        <div className={styles.switcherSearch}>
          <Icon name="search" />
          <input
            ref={search}
            type="search"
            aria-label={searchLabel}
            placeholder={searchLabel}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            // A search field clears itself on Escape; here Escape closes the list, as everywhere else in it.
            onKeyDown={(event) => {
              if (event.key !== "Escape" || preview) return;
              event.preventDefault();
              close();
            }}
            autoComplete="off"
            spellCheck={false}
          />
          <kbd aria-hidden="true">Esc</kbd>
        </div>
      )}
      <ul className={styles.switcherList} aria-label={label}>
        {entry(pinned)}
        {shown.map(entry)}
      </ul>
      {options.length === 0 ? (
        <div className={styles.switcherEmpty}>
          <span className={styles.switcherEmptyIcon}>
            <Icon name="layers" />
          </span>
          <p>{empty}</p>
        </div>
      ) : (
        shown.length === 0 && (
          <p className={styles.switcherNoMatch} role="status">
            {`${noMatch} “${query.trim()}”`}
          </p>
        )
      )}
      <div className={styles.switcherFooter}>
        <Link
          href={footer.href}
          className={`${styles.item} ${styles.switcherAction}`}
          aria-haspopup={hydrated && footer.onChoose ? "dialog" : undefined}
          data-switcher-entry=""
          onClick={(event) => {
            close();
            onChosen?.();
            if (hydrated && footer.onChoose && footer.onChoose() !== false) event.preventDefault();
          }}
        >
          <Icon name={footer.icon} />
          <span className={styles.switcherActionText}>
            <span>{footer.label}</span>
            <span className={styles.switcherActionDescription}>{footer.description}</span>
          </span>
        </Link>
      </div>
    </div>
  );

  if (preview) return <div className={`${styles.switcher} ${styles.preview}`}>{panel}</div>;

  return (
    <>
      <button
        ref={trigger}
        type="button"
        popoverTarget={`switcher-${id}`}
        className={styles.switcherTrigger}
        aria-label={`${label}, current: ${selected.label}`}
        title={selected.label}
        style={{ anchorName: `--switcher-${id}` } as React.CSSProperties}
      >
        <Avatar option={selected} />
        <span className={styles.entryLabel}>{selected.label}</span>
        {selected.tag && <Tag sans>{selected.tag}</Tag>}
        <Icon name="chevronsUpDown" className={styles.switcherChevrons} />
      </button>
      <div ref={popover} id={`switcher-${id}`} popover="auto" className={`${styles.menu} ${styles.switcher}`} style={{ positionAnchor: `--switcher-${id}` } as React.CSSProperties}>
        {panel}
      </div>
    </>
  );
}
