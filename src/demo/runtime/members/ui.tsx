"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./ui.module.css";

/**
 * Building blocks for the demo's microfrontends, styled with the portal's
 * runtime tokens. They are accessible by default: the planted defects in a few
 * older versions are written out by hand, never produced by these blocks.
 */

export function Panel({ title, actions, children, anchor, id }: { title: string; actions?: React.ReactNode; children: React.ReactNode; anchor?: string; id?: string }) {
  return (
    <div className={styles.panel} data-demo-anchor={anchor}>
      <div className={styles.panelHeader}>
        <h2 className={styles.panelTitle} id={id}>
          {title}
        </h2>
        {actions && <div className={styles.panelActions}>{actions}</div>}
      </div>
      <div className={styles.panelBody}>{children}</div>
    </div>
  );
}

type ButtonVariant = "primary" | "secondary" | "ghost";

export function Button({ variant = "secondary", anchor, children, ...props }: { variant?: ButtonVariant; anchor?: string } & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "className">) {
  return (
    <button type="button" className={[styles.button, styles[variant]].join(" ")} data-demo-anchor={anchor} {...props}>
      {children}
    </button>
  );
}

export function Field({ id, label, children, hint }: { id: string; label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      {children}
      {hint && <p className={styles.hint}>{hint}</p>}
    </div>
  );
}

export function TextInput({ anchor, ...props }: { anchor?: string } & Omit<React.InputHTMLAttributes<HTMLInputElement>, "className">) {
  return <input className={styles.input} data-demo-anchor={anchor} {...props} />;
}

export function Select({ anchor, children, ...props }: { anchor?: string } & Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "className">) {
  return (
    <select className={styles.input} data-demo-anchor={anchor} {...props}>
      {children}
    </select>
  );
}

/** Whether an element's content is wider than the element, so it scrolls sideways. */
function useScrollsSideways<T extends HTMLElement>(): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [scrolls, setScrolls] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setScrolls(element.scrollWidth > element.clientWidth + 1));
    observer.observe(element);
    if (element.firstElementChild) observer.observe(element.firstElementChild);
    return () => observer.disconnect();
  }, []);
  return [ref, scrolls];
}

/** A table that scrolls sideways when its region is narrow; while it scrolls, keyboard users can focus and scroll it. */
export function Table({ label, head, children }: { label: string; head: React.ReactNode; children: React.ReactNode }) {
  const [wrap, scrolls] = useScrollsSideways<HTMLDivElement>();
  return (
    <div ref={wrap} className={styles.tableWrap} data-scroll-x="" tabIndex={scrolls ? 0 : undefined} role={scrolls ? "region" : undefined} aria-label={scrolls ? `${label}, scrolls sideways` : undefined}>
      <table className={styles.table} aria-label={label}>
        <thead>
          <tr>{head}</tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function Th({ children, numeric = false }: { children?: React.ReactNode; numeric?: boolean }) {
  return (
    <th scope="col" className={[styles.th, numeric && styles.numeric].filter(Boolean).join(" ")}>
      {children}
    </th>
  );
}

export function Tr({ children, selected = false, anchor }: { children: React.ReactNode; selected?: boolean; anchor?: string }) {
  return (
    <tr className={[styles.tr, selected && styles.selected].filter(Boolean).join(" ")} data-demo-anchor={anchor}>
      {children}
    </tr>
  );
}

export function Td({ children, numeric = false, className }: { children?: React.ReactNode; numeric?: boolean; className?: string }) {
  return <td className={[styles.td, numeric && styles.numeric, className].filter(Boolean).join(" ")}>{children}</td>;
}

export type Tone = "positive" | "negative" | "neutral" | "accent";

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: React.ReactNode }) {
  return <span className={[styles.badge, styles[tone]].join(" ")}>{children}</span>;
}

export function Stat({ label, value, detail, tone }: { label: string; value: string; detail?: string; tone?: Tone }) {
  return (
    <div className={styles.stat}>
      <p className={styles.statLabel}>{label}</p>
      <p className={styles.statValue}>{value}</p>
      {detail && <p className={[styles.statDetail, tone && styles[tone]].filter(Boolean).join(" ")}>{detail}</p>}
    </div>
  );
}

export function Stack({ children, gap = "md" }: { children: React.ReactNode; gap?: "sm" | "md" }) {
  return <div className={gap === "sm" ? styles.stackSmall : styles.stack}>{children}</div>;
}

export function Row({ children }: { children: React.ReactNode }) {
  return <div className={styles.row}>{children}</div>;
}

export function Muted({ children }: { children: React.ReactNode }) {
  return <p className={styles.muted}>{children}</p>;
}

export const uiStyles = styles;
