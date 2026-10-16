"use client";

import { useActionState, useSyncExternalStore } from "react";
import { CopyButton } from "@/components/ui/copy-button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ButtonContent, buttonProps } from "@/components/ui/button-content";
import { RelativeTime } from "@/components/ui/relative-time";
import { SubmitButton } from "@/components/ui/submit-button";
import type { ShareState } from "./share-actions";
import styles from "./prototype.module.css";

interface SharePanelProps {
  prototypeId: string;
  number: number;
  create: (previous: ShareState) => Promise<ShareState>;
  revoke: (formData: FormData) => Promise<void>;
  links: readonly { id: string; number: number; createdAt: Date }[];
  downloadHref: string;
  downloadName: string;
  /** The Open in Vercel Sandbox control, or why it is unavailable. */
  sandbox?: React.ReactNode;
}

const subscribeNever = () => () => {};

/**
 * Taking a version out of the studio (sharing-and-export spec): a read-only
 * share link, shown once when it is created, the live links with Revoke, and
 * Download as a runnable project.
 */
export function SharePanel({ prototypeId, number, create, revoke, links, downloadHref, downloadName, sandbox }: SharePanelProps) {
  const [state, formAction] = useActionState(create, { path: null, error: null, submission: 0 });
  const origin = useSyncExternalStore(subscribeNever, () => window.location.origin, () => "");
  const url = state.path ? `${origin}${state.path}` : null;
  return (
    <div className={styles.manage} data-share-panel="">
      <form action={formAction}>
        <SubmitButton variant="secondary" size="sm" icon="link" pendingLabel="Creating link">
          {`Share v${number}`}
        </SubmitButton>
      </form>
      {state.error && <p className={styles.muted}>{state.error}</p>}
      {url && (
        <div className={styles.shareLink} data-share-link="">
          <p className={styles.muted}>{"Anyone with this link can view this version, without a workspace. Copy it now: it isn't shown again."}</p>
          <span className={styles.shareUrl}>
            <code>{url}</code>
            <CopyButton value={url} label="Copy share link" />
          </span>
        </div>
      )}
      {links.length > 0 && (
        <ul className={styles.shareList} aria-label="Share links">
          {links.map((link) => (
            <li key={link.id} data-share={link.id}>
              <span>
                {`Link to v${link.number}, created `}
                <RelativeTime value={link.createdAt} />
              </span>
              <ConfirmDialog action={revoke} fields={{ prototype: prototypeId, share: link.id }} trigger={{ label: "Revoke", variant: "tertiary", size: "sm" }} title={`Revoke the link to v${link.number}?`} confirmLabel="Revoke link" tone="danger">
                {"Anyone who opens it afterward sees a page that isn't found."}
              </ConfirmDialog>
            </li>
          ))}
        </ul>
      )}
      {/* A plain link, so the browser downloads the archive rather than navigating to it. */}
      <a href={downloadHref} download={downloadName} {...buttonProps("secondary", "sm")}>
        <ButtonContent icon="download" size="sm">{`Download v${number}`}</ButtonContent>
      </a>
      {sandbox}
    </div>
  );
}
