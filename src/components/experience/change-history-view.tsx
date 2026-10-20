"use client";

import { ButtonLink } from "@/components/ui/button";
import { buttonProps } from "@/components/ui/button-content";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel } from "@/components/ui/panel";
import { RelativeTime } from "@/components/ui/relative-time";
import { Section } from "@/components/ui/section";
import { Secondary, Table, Td, Th } from "@/components/ui/table";
import { Tag } from "@/components/ui/tag";
import { useEditor } from "./store";
import styles from "./editor.module.css";

/**
 * Change history (experience-editor spec, "Change history lists and reverts
 * pending changes"): every pending change with its location, field,
 * original value, marked Default when it's built in, and new value, each
 * revertible on its own; then the Portal's saved versions, newest first.
 */
export function ChangeHistoryView() {
  const editor = useEditor();
  const base = `/navigation/${editor.portal.publicId}/editor`;
  return (
    <div className={styles.fullPage}>
      <ButtonLink href={`${base}/frame-zones`} variant="tertiary" size="sm" icon="arrowLeft">
        Back to workspace
      </ButtonLink>
      <h2 className={styles.fullPageTitle}>Change history</h2>
      <Section title="Pending option overrides" description="Each row is one change waiting to be saved. Revert drops that change alone; Save in the top bar commits every row as a new saved version.">
        <Panel flush>
          {editor.pending.length > 0 ? (
            <Table
              label="Pending changes"
              head={
                <>
                  <Th>Location</Th>
                  <Th>Field</Th>
                  <Th>Original</Th>
                  <Th>New</Th>
                  <Th align="actions">Actions</Th>
                </>
              }
            >
              {editor.pending.map((row) => (
                <tr key={row.key}>
                  <Td label="Location">
                    {row.location}
                    <Secondary>{row.section}</Secondary>
                  </Td>
                  <Td label="Field">{row.field}</Td>
                  <Td label="Original">
                    <span className={styles.value}>
                      {row.original}
                      {row.originalIsDefault && <Tag sans>Default</Tag>}
                    </span>
                  </Td>
                  <Td label="New">{row.next}</Td>
                  <Td label="Actions" align="actions">
                    <button type="button" {...buttonProps("tertiary", "sm")} onClick={() => editor.revert(row.key)} aria-label={`Revert ${row.field} in ${row.section}`}>
                      Revert
                    </button>
                  </Td>
                </tr>
              ))}
            </Table>
          ) : (
            <EmptyState title="No pending changes" icon="check">
              Every change in the editor is saved.
            </EmptyState>
          )}
        </Panel>
      </Section>
      <Section title="Saved versions" description="Each save is a numbered version, kept with who stated they saved it.">
        <Panel flush>
          {editor.versions.length > 0 ? (
            <Table
              label="Saved versions"
              head={
                <>
                  <Th>Version</Th>
                  <Th>Changes</Th>
                  <Th>By</Th>
                  <Th>When</Th>
                </>
              }
            >
              {editor.versions.map((version) => (
                <tr key={version.number}>
                  <Td label="Version">{`Version ${version.number}`}</Td>
                  <Td label="Changes">
                    {`${version.changeCount} change${version.changeCount === 1 ? "" : "s"}`}
                    <Secondary>{version.changes.slice(0, 3).join("; ") + (version.changes.length > 3 ? "; …" : "")}</Secondary>
                  </Td>
                  <Td label="By">
                    {version.actor} <Secondary>{version.attribution === "system" ? "Automatic" : "Unverified"}</Secondary>
                  </Td>
                  <Td label="When">
                    <RelativeTime value={new Date(version.createdAt)} />
                  </Td>
                </tr>
              ))}
            </Table>
          ) : (
            <EmptyState title="No saved versions yet">{`${editor.portal.label} uses the default experience until its first save.`}</EmptyState>
          )}
        </Panel>
      </Section>
    </div>
  );
}
