"use client";

import Link from "next/link";
import { createContext, use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon, type IconName } from "./icon";
import { toneClass } from "./indicator";
import styles from "./toast.module.css";

/**
 * Transient feedback for completed actions. Success and info toasts dismiss
 * themselves after a pause that stops while hovered or focused; warnings and
 * errors stay until dismissed. At most three show at once, and a toast whose
 * id is already showing is not added again.
 */

export type ToastTone = "success" | "info" | "warning" | "error";

export interface ToastAction {
  label: string;
  /** Runs client code, such as Undo. */
  onAction?: () => void;
  /** Or navigates. */
  href?: string;
}

export interface ToastInput {
  /** Identifies the event, so a repeated render does not show it twice. */
  id?: string;
  tone?: ToastTone;
  title: string;
  description?: string;
  action?: ToastAction;
}

interface Toast extends Required<Pick<ToastInput, "id" | "tone" | "title">> {
  description?: string;
  action?: ToastAction;
}

const MAX_VISIBLE = 3;
const DURATION = 6_000;
const ICONS: Record<ToastTone, IconName> = { success: "checkCircle", info: "info", warning: "alert", error: "xCircle" };

interface ToastApi {
  toast: (input: ToastInput) => string;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const api = use(ToastContext);
  if (!api) throw new Error("useToast must be used inside ToastProvider");
  return api;
}

let sequence = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [announcement, setAnnouncement] = useState({ polite: "", assertive: "" });

  const dismiss = useCallback((id: string) => setToasts((current) => current.filter((toast) => toast.id !== id)), []);

  const toast = useCallback((input: ToastInput) => {
    const id = input.id ?? `toast-${++sequence}`;
    const tone = input.tone ?? "success";
    setToasts((current) => (current.some((existing) => existing.id === id) ? current : [...current, { ...input, id, tone }].slice(-MAX_VISIBLE)));
    const text = [input.title, input.description].filter(Boolean).join(" ");
    setAnnouncement(tone === "error" || tone === "warning" ? { polite: "", assertive: text } : { polite: text, assertive: "" });
    return id;
  }, []);

  const api = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext value={api}>
      {children}
      <section className={styles.viewport} aria-label="Notifications">
        <ol className={styles.list}>
          {toasts.map((item) => (
            <ToastCard key={item.id} toast={item} onDismiss={dismiss} />
          ))}
        </ol>
      </section>
      <div className="visually-hidden" aria-live="polite">
        {announcement.polite}
      </div>
      <div className="visually-hidden" aria-live="assertive">
        {announcement.assertive}
      </div>
    </ToastContext>
  );
}

function ToastCard({ toast, onDismiss }: { toast: Toast; onDismiss: (id: string) => void }) {
  const persistent = toast.tone === "error" || toast.tone === "warning";
  const [paused, setPaused] = useState(false);
  const remaining = useRef(DURATION);

  useEffect(() => {
    if (persistent || paused) return;
    const started = Date.now();
    const timer = setTimeout(() => onDismiss(toast.id), remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current -= Date.now() - started;
    };
  }, [persistent, paused, toast.id, onDismiss]);

  return (
    <li
      className={`${styles.toast} ${toneClass}`}
      data-tone={toast.tone}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setPaused(false);
      }}
    >
      <ToastContent toast={toast} onDismiss={onDismiss} />
      <button type="button" className={styles.close} aria-label="Dismiss notification" onClick={() => onDismiss(toast.id)}>
        <Icon name="x" size={14} />
      </button>
    </li>
  );
}

/**
 * A toast's content, the same in a live toast and in an outcome the server
 * renders before JavaScript runs: its tone's icon, its title and
 * description, and its action. A link action works without JavaScript; one
 * that runs code needs it.
 */
function ToastContent({ toast, onDismiss }: { toast: Pick<Toast, "id" | "tone" | "title" | "description" | "action">; onDismiss?: (id: string) => void }) {
  const { action } = toast;
  return (
    <>
      <Icon name={ICONS[toast.tone]} className={styles.icon} />
      <div className={styles.body}>
        <p className={styles.title}>{toast.title}</p>
        {toast.description && <p className={styles.description}>{toast.description}</p>}
      </div>
      {action?.href && (
        <Link href={action.href} className={styles.action} onClick={() => onDismiss?.(toast.id)}>
          {action.label}
        </Link>
      )}
      {action && !action.href && onDismiss && (
        <button
          type="button"
          className={styles.action}
          onClick={() => {
            action.onAction?.();
            onDismiss(toast.id);
          }}
        >
          {action.label}
        </button>
      )}
    </>
  );
}

/**
 * A toast the server renders, where and as a live toast shows, so it's seen
 * on first paint and without JavaScript; it has no dismiss button, which
 * needs JavaScript, and the live toast takes over once the page hydrates.
 */
export function StaticToast({ toast }: { toast: Pick<Toast, "id" | "tone" | "title" | "description" | "action"> }) {
  return (
    <div className={styles.viewport}>
      <div className={`${styles.toast} ${toneClass}`} data-tone={toast.tone} data-static="" role="status">
        <ToastContent toast={toast} />
      </div>
    </div>
  );
}
