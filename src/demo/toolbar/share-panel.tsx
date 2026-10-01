"use client";

import { useEffect, useEffectEvent, useState } from "react";
import { ToolPanel } from "@/components/toolbar/tool-panel";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { TextInput } from "@/components/ui/form";
import { useCurrentRoute, useRuntime, useViewState } from "../runtime/runtime-context";
import styles from "./tools.module.css";

/**
 * Share: a link to the current view, capturing its route, microfrontend
 * overrides, theme, and persona. Anyone with the link can view the
 * application and its comments, and add comments.
 */
export function SharePanel() {
  const { descriptor } = useRuntime();
  const view = useViewState();
  const route = useCurrentRoute();
  const [link, setLink] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [creating, setCreating] = useState(false);

  const create = () => {
    setCreating(true);
    setFailed(false);
    fetch("/api/demo/shares", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ application: descriptor.applicationId, state: { route: route.path, overrides: view.overrides, theme: view.theme, persona: view.personaId } }),
    })
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
      <p className={styles.muted}>{`The link opens ${route.label} with this view's microfrontend versions, ${view.theme} theme, and persona. Changes the recipient makes do not affect your view.`}</p>
      <div className={styles.actions}>
        <Button onClick={() => create()} disabled={creating} icon="link">
          Create new link
        </Button>
      </div>
    </ToolPanel>
  );
}
