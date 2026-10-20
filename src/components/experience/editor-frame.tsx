"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { buttonProps } from "@/components/ui/button-content";
import { Icon, type IconName } from "@/components/ui/icon";
import { useToast } from "@/components/ui/toast";
import { useEditor } from "./store";
import styles from "./editor.module.css";

const VIEWS: { id: string; label: string; icon: IconName }[] = [
  { id: "frame-zones", label: "Frame Zones", icon: "frame" },
  { id: "frame-overlays", label: "Frame Overlays", icon: "layers" },
  { id: "capabilities", label: "Capability Toolkit", icon: "grid" },
  { id: "configuration", label: "Portal Configuration", icon: "settings" },
];

/** The reference deployment the running portal opens in, by the theme's shell. */
const RUNNING_PORTAL: Record<"access" | "markets", string> = { access: "ref-payments-workspace", markets: "ref-market-watch" };

const plural = (count: number) => `${count} unsaved change${count === 1 ? "" : "s"}`;

/**
 * The editor's frame (experience-editor spec): the icon rail of four views,
 * the top bar with Change history, Undo, Redo, the pending count, Save, and
 * Open running portal, what the last save said, and the guard that asks
 * before leaving with changes pending.
 */
export function EditorFrame({ children }: { children: React.ReactNode }) {
  const editor = useEditor();
  const pathname = usePathname();
  const { toast } = useToast();
  const base = `/navigation/${editor.portal.publicId}/editor`;
  const current = VIEWS.find((view) => pathname.startsWith(`${base}/${view.id}`))?.id ?? null;
  const savedTheme = editor.catalogs.themes.find((theme) => theme.id === editor.saved.theme.id);
  const running = `/run/${RUNNING_PORTAL[savedTheme?.shell ?? "access"]}?portal=${editor.portal.publicId}`;
  const count = editor.pending.length;

  const save = async () => {
    const result = await editor.save();
    if (result.kind === "saved") toast({ id: `saved-${result.number}`, tone: "success", title: `Version ${result.number} is saved.`, description: "The running portal shows it from its next load." });
    else if (result.kind === "nothing") toast({ tone: "info", title: result.message ?? "There are no changes to save." });
  };

  return (
    <div className={styles.editor} data-experience-editor="">
      <noscript>
        <p className={styles.noscript}>The experience editor needs JavaScript. The Portal&apos;s Navigation page shows its saved menu.</p>
      </noscript>
      <div className={styles.topbar}>
        <nav aria-label="Editor views" className={styles.rail}>
          {VIEWS.map((view) => (
            <Link key={view.id} href={`${base}/${view.id}`} className={styles.railItem} aria-current={current === view.id ? "page" : undefined} aria-label={view.label} title={view.label}>
              <Icon name={view.icon} />
            </Link>
          ))}
        </nav>
        <div className={styles.topbarActions}>
          <Link href={`${base}/change-history`} {...buttonProps("tertiary", "md", true)} aria-label="Change history" title="Change history">
            <Icon name="history" />
          </Link>
          <button type="button" {...buttonProps("tertiary", "md", true)} aria-label="Undo" title="Undo" disabled={editor.state.past.length === 0} onClick={editor.undo}>
            <Icon name="undo" />
          </button>
          <button type="button" {...buttonProps("tertiary", "md", true)} aria-label="Redo" title="Redo" disabled={editor.state.future.length === 0} onClick={editor.redo}>
            <Icon name="redo" />
          </button>
          {count > 0 && (
            <Link href={`${base}/change-history`} className={styles.pendingLink} data-pending-count={count}>
              {plural(count)}
            </Link>
          )}
          {editor.demoEnabled ? (
            <a href={running} target="_blank" rel="noopener" {...buttonProps("secondary", "md")}>
              <Icon name="external" size={16} />
              Open running portal<span className="visually-hidden"> (opens in a new tab)</span>
            </a>
          ) : (
            <button type="button" {...buttonProps("secondary", "md")} disabled title="The running portal is part of the template demo, which is turned off">
              Open running portal<span className="visually-hidden"> (unavailable: the template demo is turned off)</span>
            </button>
          )}
          <button type="button" {...buttonProps("primary", "md")} disabled={count === 0 || editor.saving} onClick={save}>
            {editor.saving ? "Saving" : "Save"}
          </button>
        </div>
      </div>
      <SaveProblems />
      <div className={styles.body}>{children}</div>
      <LeaveGuard base={base} />
    </div>
  );
}

const SECTION_VIEWS: Record<string, string> = { "frame-zones": "Frame Zones", "frame-overlays": "Frame Overlays", capabilities: "Capability Toolkit", configuration: "Portal Configuration", messages: "System messages", menu: "Menu editor" };

/** What a refused save said: the problems, each linking to its field, or that someone else saved first. */
function SaveProblems() {
  const editor = useEditor();
  const router = useRouter();
  const outcome = editor.outcome;
  const base = `/navigation/${editor.portal.publicId}/editor`;
  if (!outcome || (outcome.kind !== "invalid" && outcome.kind !== "stale")) return null;
  if (outcome.kind === "stale") {
    return (
      <div className={styles.problems} role="alert">
        <p className={styles.problemsTitle}>{`${editor.portal.label} changed since you opened it`}</p>
        <p>{outcome.message}</p>
        <div className={styles.problemsActions}>
          <button
            type="button"
            {...buttonProps("secondary", "sm")}
            onClick={() => {
              try {
                window.sessionStorage.removeItem(`fabricate-experience:${editor.portal.publicId}:${editor.baseNumber}`);
              } catch {
                // Nothing stored.
              }
              window.location.reload();
            }}
          >
            Reload latest
          </button>
          <button type="button" {...buttonProps("tertiary", "sm")} onClick={editor.clearOutcome}>
            Keep editing
          </button>
        </div>
      </div>
    );
  }
  const issues = outcome.issues ?? [];
  return (
    <div className={styles.problems} role="alert">
      <p className={styles.problemsTitle}>{`The changes weren't saved: ${issues.length} problem${issues.length === 1 ? "" : "s"} to fix`}</p>
      <ul className={styles.problemsList}>
        {issues.map((issue) => {
          const href = issue.view === "configuration" ? `${base}/configuration/${issue.section ?? "brand"}` : `${base}/${issue.view}`;
          return (
            <li key={`${issue.path}:${issue.message}`}>
              <Link
                href={href}
                onClick={(event) => {
                  event.preventDefault();
                  router.push(href);
                }}
              >
                {SECTION_VIEWS[issue.view] ?? issue.view}
                {issue.section ? ` · ${issue.section}` : ""}
              </Link>
              {`: ${issue.message}`}
            </li>
          );
        })}
      </ul>
      <button type="button" {...buttonProps("tertiary", "sm")} onClick={editor.clearOutcome}>
        Dismiss
      </button>
    </div>
  );
}

/** Asks before a link takes the operator out of the editor with changes pending. */
function LeaveGuard({ base }: { base: string }) {
  const editor = useEditor();
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [target, setTarget] = useState<string | null>(null);
  const count = editor.pending.length;

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (count === 0 || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
      const anchor = (event.target as HTMLElement | null)?.closest("a[href]") as HTMLAnchorElement | null;
      if (!anchor || anchor.target === "_blank") return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname.startsWith(base)) return;
      event.preventDefault();
      setTarget(url.pathname + url.search + url.hash);
      dialog.current?.showModal();
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [count, base]);

  return (
    <dialog ref={dialog} className={styles.leaveDialog} aria-labelledby="leave-title" onClose={() => setTarget(null)}>
      <h2 id="leave-title" className={styles.dialogTitle}>{`Leave with ${plural(count)}?`}</h2>
      <p className={styles.dialogText}>They stay in this browser tab until you come back, but nobody else sees them until you save.</p>
      <div className={styles.dialogActions}>
        <button type="button" {...buttonProps("secondary")} autoFocus onClick={() => dialog.current?.close()}>
          Stay
        </button>
        <button
          type="button"
          {...buttonProps("primary")}
          onClick={() => {
            const href = target;
            dialog.current?.close();
            if (href) router.push(href);
          }}
        >
          Leave
        </button>
      </div>
    </dialog>
  );
}
