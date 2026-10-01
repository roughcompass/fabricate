"use client";

import { Fragment, use } from "react";
import { type RegionArea, memberById } from "@/lib/demo/catalog";
import { elementFor } from "./registry";
import { LoadedContext, useActivity, useRuntime, useVersions } from "./runtime-context";
import styles from "./region.module.css";

/**
 * One microfrontend on the page. It identifies its member and version for the
 * toolbar, shows a skeleton until its scripted load finishes or while a new
 * version loads, and remounts only itself when its version changes, so the
 * rest of the page keeps its state.
 */
export function MicrofrontendRegion({ member, area }: { member: string; area: RegionArea }) {
  const { app } = useRuntime();
  const versions = useVersions();
  const loaded = use(LoadedContext);
  const { swapping } = useActivity();
  const definition = memberById(app, member)!;
  const version = versions[member]!;
  const ready = loaded.has(member) && !swapping.has(member);
  const element = elementFor(member, version);

  return (
    <section
      className={[styles.region, styles[area]].join(" ")}
      aria-label={definition.name}
      aria-busy={!ready}
      data-demo-mfe={member}
      data-demo-version={version}
      data-demo-state={ready ? "ready" : swapping.has(member) ? "swapping" : "loading"}
    >
      {ready && element ? (
        <Fragment key={`${member}@${version}`}>{element}</Fragment>
      ) : (
        <div className={styles.skeleton} aria-hidden="true">
          <span className={styles.skeletonTitle} />
          <span className={styles.skeletonLine} />
          <span className={styles.skeletonLine} />
          <span className={styles.skeletonShort} />
        </div>
      )}
      {!ready && <span className="visually-hidden">{`Loading ${definition.name}`}</span>}
    </section>
  );
}
