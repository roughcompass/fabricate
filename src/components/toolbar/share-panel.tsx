"use client";

import { useEffect, useEffectEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { TextInput } from "@/components/ui/form";
import { useMicrofrontends } from "./microfrontends/microfrontends-state";
import type { AppliedRoute } from "./routing/routing-client";
import { useSession } from "./session/session-state";
import { useSettings } from "./settings/settings-state";
import { type ThemeChoice, choosesTheme } from "./settings/theme";
import { useTargetDocument } from "./target-document";
import { ToolPanel } from "./tool-panel";
import styles from "./share.module.css";

/**
 * Share (template-demo/toolbar spec, "Visitors can share an application
 * view"): a link to the view the visitor has open, capturing the
 * application, the commit of the build shown, and the route, with the view's
 * comments. Opening the panel creates a link; Create new link makes another
 * for the route shown now.
 *
 * The link also captures the view's Salt theme and Microfrontends routing,
 * and the server records the session preset it starts with, by name
 * (restore-toolbar-tools-and-branch-previews, design decision 5). Whenever
 * any of them is set, the panel says what opening the link applies in the
 * recipient's browser, since routing registers a service worker there.
 */

/** What the link captures of the view's routing: each route's build, never an address of the sharer's own. */
function sharedRouting(routes: readonly AppliedRoute[]) {
  return routes.map((route) => ({ remote: route.name, mechanism: route.mechanism, from: route.from, target: { application: route.target.slug, ...(route.target.preview ? { preview: route.target.preview } : {}), build: route.target.build } }));
}

/** A theme in words, setting by setting: `dark mode, high density`. */
function themeWords(theme: ThemeChoice): string {
  return [theme.mode && `${theme.mode} mode`, theme.density && `${theme.density} density`, theme.accent && `${theme.accent} accent`, theme.corner && `${theme.corner} corners`].filter(Boolean).join(", ");
}

/** What opening a link applies in the recipient's browser, sentence by sentence; nothing for a plain view. */
export function appliesStatement(view: { routed: boolean; theme: ThemeChoice; preset: string | null }): string[] {
  return [
    view.routed ? "Opening the link applies your Microfrontends routing, which registers a service worker in the recipient's browser for the routed build." : null,
    choosesTheme(view.theme) ? `It applies your Salt theme: ${themeWords(view.theme)}.` : null,
    view.preset ? `It starts with the session preset "${view.preset}", whose values aren't in the link.` : null,
  ].filter((sentence): sentence is string => sentence !== null);
}
export function SharePanel({ slug, preview, name, share }: { slug: string; preview: string | null; name: string; share: string | null }) {
  const target = useTargetDocument();
  const { routes } = useMicrofrontends();
  const { theme } = useSettings();
  const { applied } = useSession();
  const [link, setLink] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [creating, setCreating] = useState(false);

  const create = () => {
    setCreating(true);
    setFailed(false);
    const query = new URLSearchParams({ application: slug, ...(preview ? { preview } : {}), ...(share ? { share } : {}) });
    fetch(`/api/workspace/shares?${query}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ commit: target.commit, route: `${target.route}${target.search}`, view: { ...(choosesTheme(theme) ? { theme } : {}), ...(routes.length ? { routing: sharedRouting(routes) } : {}) } }) })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
      .then((data: { path: string }) => setLink(`${window.location.origin}${data.path}`))
      .catch(() => setFailed(true))
      .finally(() => setCreating(false));
  };
  const createOnOpen = useEffectEvent(create);
  const statement = appliesStatement({ routed: routes.length > 0, theme, preset: applied?.name ?? null });

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
      {statement.length > 0 && (
        <p className={styles.applies} data-share-applies="">
          {statement.join(" ")}
        </p>
      )}
      <div className={styles.actions}>
        <Button onClick={() => create()} disabled={creating} icon="link">
          Create new link
        </Button>
      </div>
    </ToolPanel>
  );
}
