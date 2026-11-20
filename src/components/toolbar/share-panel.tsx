"use client";

import { useEffect, useEffectEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { TextInput } from "@/components/ui/form";
import { useTargetDocument } from "./target-document";
import { ToolPanel } from "./tool-panel";
import styles from "./share.module.css";

/**
 * Share (template-demo/toolbar spec, "Visitors can share an application
 * view"): a link to the view the visitor has open, capturing the
 * application, the commit of the build shown, and the route, with the view's
 * comments. Opening the panel creates a link; Create new link makes another
 * for the route shown now.
 */
export function SharePanel({ slug, name, share }: { slug: string; name: string; share: string | null }) {
  const target = useTargetDocument();
  const [link, setLink] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [creating, setCreating] = useState(false);

  const create = () => {
    setCreating(true);
    setFailed(false);
    const query = new URLSearchParams({ application: slug, ...(share ? { share } : {}) });
    fetch(`/api/workspace/shares?${query}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ commit: target.commit, route: `${target.route}${target.search}` }) })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
      .then((data: { path: string }) => setLink(`${window.location.origin}${data.path}`))
      .catch(() => setFailed(true))
      .finally(() => setCreating(false));
  };
  const createOnOpen = useEffectEvent(create);

  useEffect(() => {
    // A timer callback starts the request, so the effect itself never sets state.
    const timer = window.setTimeout(() => createOnOpen(), 0);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <ToolPanel title="Share" description="Anyone with the link can view this application and its comments, and add comments.">
      {link ? (
        <div className={styles.shareRow}>
          <TextInput id="share-link" label="Link to this view" mono readOnly value={link} onFocus={(event) => event.currentTarget.select()} />
          <CopyButton value={link} label="Copy link" />
        </div>
      ) : (
        <p className={styles.muted} role="status">
          {failed ? "The link could not be created. Try again." : "Creating a link…"}
        </p>
      )}
      <p className={styles.muted} data-share-view="">{`The link opens ${name} at ${target.route}${target.search}, built from commit ${target.commit.slice(0, 12)}, with this view's comments.`}</p>
      <div className={styles.actions}>
        <Button onClick={() => create()} disabled={creating} icon="link">
          Create new link
        </Button>
      </div>
    </ToolPanel>
  );
}
