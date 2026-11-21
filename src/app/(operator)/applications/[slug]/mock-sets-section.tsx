import Link from "next/link";
import { ActionButton, ButtonLink } from "@/components/ui/button";
import { formatBytes, formatNumber } from "@/components/ui/count";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Disclosure } from "@/components/ui/disclosure";
import { EmptyState } from "@/components/ui/empty-state";
import { MenuButton, MenuItem } from "@/components/ui/menu";
import { Alert } from "@/components/ui/alert";
import { Panel } from "@/components/ui/panel";
import { RelativeTime } from "@/components/ui/relative-time";
import { Section } from "@/components/ui/section";
import { Primary, RowActions, Secondary, Table, Td, Th } from "@/components/ui/table";
import { Tag } from "@/components/ui/tag";
import type { Application } from "@/lib/applications/records";
import type { MockSetSummary } from "@/lib/mocks/records";
import { FAILURE_LABELS, type FailedCalls, SOURCE_LABELS } from "@/lib/mocks/views";
import { routes } from "@/lib/web/routes";
import { addFailedCallsAction, clearDefaultAction, deleteSetAction, dismissFailuresAction, setDefaultAction } from "./mock-sets/actions";
import styles from "../applications.module.css";

/**
 * An application's Mock sets section (add-mock-sets, design decision 18;
 * mock-sets spec, "The application page lists its mock sets"): between
 * Previews and Builds, a table of its sets by name, each with its default
 * mark, rules, size, source, and last change. Upload HAR and New mock set are
 * the section's actions, and the empty state offers Upload HAR. Row actions
 * are in an overflow menu: Set as default or Stop using as default, Export
 * HAR, and Delete mock set, which asks first. At most 10 rows, so no pages.
 */
export function MockSetsSection({ application, sets }: { application: Pick<Application, "slug" | "name">; sets: readonly MockSetSummary[] }) {
  const upload = (
    <ButtonLink href={routes.mockSetUpload(application.slug)} icon="arrowUp" size="sm">
      Upload HAR
    </ButtonLink>
  );
  return (
    <Section id="mock-sets" title="Mock sets" description="Recorded or written answers to the application's API calls, applied in previews and screenshots." actions={sets.length > 0 && <MockSetActions slug={application.slug} upload={upload} />}>
      <Panel flush>
        {sets.length === 0 ? (
          <EmptyState title="No mock sets" action={<MockSetActions slug={application.slug} upload={upload} />} icon="network">
            Mock sets answer the application&apos;s API calls in previews, so its pages show data without a backend. Upload a HAR file recorded against a test environment to start one.
          </EmptyState>
        ) : (
          <Table
            label={`Mock sets of ${application.name}`}
            head={
              <>
                <Th>Name</Th>
                <Th align="numeric">Rules</Th>
                <Th align="numeric">Size</Th>
                <Th>Source</Th>
                <Th>Last changed</Th>
                <Th align="actions" hidden>
                  Actions
                </Th>
              </>
            }
          >
            {sets.map((set) => (
              <MockSetRow key={set.publicId} slug={application.slug} set={set} />
            ))}
          </Table>
        )}
      </Panel>
    </Section>
  );
}

function MockSetActions({ slug, upload }: { slug: string; upload: React.ReactNode }) {
  return (
    <>
      {upload}
      <ButtonLink href={routes.newMockSet(slug)} icon="plus" size="sm">
        New mock set
      </ButtonLink>
    </>
  );
}

function MockSetRow({ slug, set }: { slug: string; set: MockSetSummary }) {
  return (
    <tr data-mock-set={set.name}>
      <Td label="Name">
        <Primary>
          <Link href={routes.mockSet(slug, set.publicId)}>{set.name}</Link> {set.isDefault && <Tag sans>Default</Tag>}
        </Primary>
        {set.description && <Secondary>{set.description}</Secondary>}
      </Td>
      <Td label="Rules" align="numeric">
        {formatNumber(set.ruleCount)}
      </Td>
      <Td label="Size" align="numeric">
        {formatBytes(set.bodyBytes)}
      </Td>
      <Td label="Source">
        {SOURCE_LABELS[set.source]}
        {set.sourceFile && <Secondary mono>{set.sourceFile}</Secondary>}
      </Td>
      <Td label="Last changed">
        <RelativeTime value={set.updatedAt} />
        {set.updatedByName && <Secondary>{`by ${set.updatedByName}`}</Secondary>}
      </Td>
      <Td align="actions">
        <RowActions>
          <ConfirmDialog
            action={deleteSetAction}
            fields={{ application: slug, set: set.publicId }}
            trigger={{ label: "Delete mock set", icon: "trash" }}
            menu={{
              label: `Actions for ${set.name}`,
              size: "sm",
              variant: "tertiary",
              items: (
                <>
                  <MenuButton formAction={set.isDefault ? clearDefaultAction : setDefaultAction} icon={set.isDefault ? "x" : "check"}>
                    {set.isDefault ? "Stop using as default" : "Set as default"}
                  </MenuButton>
                  <MenuItem href={routes.mockSetHar(slug, set.publicId)} icon="download">
                    Export HAR
                  </MenuItem>
                </>
              ),
            }}
            title={`Delete the mock set ${set.name}?`}
            confirmLabel="Delete mock set"
            tone="danger"
          >
            <p>{`${set.name} and its ${set.ruleCount === 1 ? "rule are" : `${formatNumber(set.ruleCount)} rules are`} deleted for everyone who opens the application. Views that chose it apply their default set again.`}</p>
            {set.isDefault && <p>{"It's the application's default, so the application will have no default set, and its screenshots will show what loads without mocks."}</p>}
          </ConfirmDialog>
        </RowActions>
      </Td>
    </tr>
  );
}

/**
 * The failed-calls alert (mock-sets spec, "The application page says when
 * API calls failed"): when the capture of the current build recorded failed
 * API calls, how many, naming the set applied if any, with each call and
 * what happened to it in a disclosure. It offers Upload HAR, and Start a mock
 * set from these calls, or Add rules to the set it was captured with, and
 * Dismiss for this build.
 */
export function FailedCallsAlert({ slug, failed }: { slug: string; failed: FailedCalls | null }) {
  if (!failed || failed.dismissed || failed.total === 0) return null;
  const count = failed.total === 1 ? "1 API call" : `${formatNumber(failed.total)} API calls`;
  const title = failed.set ? `${count} failed when this build loaded with "${failed.set.name}"` : `${count} failed when this build loaded`;
  const mockable = failed.calls.some((call) => call.kind !== "websocket");
  return (
    <Alert
      tone="warning"
      title={title}
      actions={
        <span className={styles.alertActions} data-failed-calls-actions="">
          <ButtonLink href={routes.mockSetUpload(slug, failed.set ? { set: failed.set.publicId } : undefined)} size="sm" icon="arrowUp">
            Upload HAR
          </ButtonLink>
          {mockable &&
            (failed.set ? (
              <ActionButton action={addFailedCallsAction} fields={{ application: slug, set: failed.set.publicId }} size="sm" icon="plus">
                {`Add rules to ${failed.set.name}`}
              </ActionButton>
            ) : (
              <ButtonLink href={routes.newMockSet(slug, { from: "failed-calls" })} size="sm" icon="plus">
                Start a mock set from these calls
              </ButtonLink>
            ))}
          <ActionButton action={dismissFailuresAction} fields={{ application: slug }} size="sm" variant="tertiary">
            Dismiss
          </ActionButton>
        </span>
      }
    >
      <p>{failed.set ? "Calls no rule of the set answered failed, so parts of the screenshot may be empty." : "The build's calls to its APIs failed, so parts of the screenshot may be empty. A mock set can answer them."}</p>
      <Disclosure summary={failed.total === 1 ? "The call" : `The ${formatNumber(failed.total)} calls`} variant="plain">
        <ul className={styles.failedCalls} aria-label="Failed API calls">
          {failed.calls.map((call) => (
            <li key={call.position} data-failed-call={call.kind}>
              <code>{`${call.method} ${call.url}`}</code>
              {` · ${FAILURE_LABELS[call.kind](call.status)}`}
              {call.occurrences > 1 && ` · ${formatNumber(call.occurrences)} times`}
            </li>
          ))}
          {failed.total > failed.calls.length && <li>{`and ${formatNumber(failed.total - failed.calls.length)} more`}</li>}
        </ul>
      </Disclosure>
    </Alert>
  );
}
