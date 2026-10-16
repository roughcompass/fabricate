import type { Metadata } from "next";
import Link from "next/link";
import { AiNotice } from "@/components/prototypes/ai-notice";
import { ButtonLink } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { OutcomeToast, param } from "@/components/ui/outcome-toast";
import { Page, PageHeader } from "@/components/ui/page";
import { Panel } from "@/components/ui/panel";
import { RelativeTime } from "@/components/ui/relative-time";
import { Status } from "@/components/ui/status";
import { Primary, Secondary, Table, Td, Th } from "@/components/ui/table";
import { listPrototypes } from "@/lib/prototypes/prototypes";
import type { Scope } from "@/lib/prototypes/types";
import { type OpenGeneration, getGeneration, openGenerations, progressVersion } from "@/lib/prototypes/variants";
import { ProgressPoller } from "@/components/progress-poller";
import { prototypesRequest } from "@/lib/prototypes/request";
import { checkSummary } from "@/lib/prototypes/summary";
import { resetPrototypesAction } from "./actions";
import { prototypesListOutcome } from "./outcomes";

export const metadata: Metadata = { title: "Prototypes" };

const SCOPE_LABELS: Record<Scope, string> = { page: "Page", component: "Component", "portal-member": "Microfrontend", "portal-shell": "Shell" };

/** All Prototypes (prototypes/versions spec, "The Prototypes list shows every prototype"): most recently updated first. */
export default async function PrototypesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const { db, workspace } = await prototypesRequest();
  const [rows, open] = await Promise.all([listPrototypes(db, workspace.id), openGenerations(db, workspace.id)]);
  // While a generation runs, the list refreshes when its progress changes.
  const running = open.find((entry) => entry.running > 0);
  const watching = running ? { id: running.generation.id, version: progressVersion(await getGeneration(db, workspace.id, running.generation.id)) } : null;
  const create = (
    <ButtonLink href="/prototypes/new" variant="primary" icon="plus">
      New prototype
    </ButtonLink>
  );

  return (
    <Page>
      <PageHeader
        title="Prototypes"
        description="Salt prototypes generated for your personas, checked by DE FabLab, and refined into versions. Feedback becomes lessons that later generations apply."
        primaryAction={create}
        extraActions={
          <ConfirmDialog action={resetPrototypesAction} trigger={{ label: "Reset Prototypes" }} menu={{ label: "More actions" }} title="Reset Prototypes?" confirmLabel="Reset Prototypes" tone="danger">
            {"Your prototypes, versions, feedback, lessons, personas, page shell, and share links are deleted, and the seeded examples come back. Templates you accepted stay in the gallery, and the template demo isn't affected."}
          </ConfirmDialog>
        }
        alerts={<OutcomeToast outcome={prototypesListOutcome(param(query, "notice"))} />}
      />
      <AiNotice />
      {watching && <ProgressPoller url={`/api/prototypes/generations/${watching.id}/status`} version={watching.version} />}
      {open.length > 0 && <OpenGenerations open={open} />}
      <Panel flush>
        {rows.length ? (
          <Table
            label="Prototypes"
            head={
              <>
                <Th>Prototype</Th>
                <Th>Personas</Th>
                <Th align="numeric">Version</Th>
                <Th>Checks</Th>
                <Th>Template</Th>
                <Th>Updated</Th>
              </>
            }
          >
            {rows.map(({ prototype, latest, personas, template }) => {
              const summary = latest ? checkSummary(latest) : null;
              return (
                <tr key={prototype.id} data-prototype={prototype.id}>
                  <Td label="Prototype">
                    <Primary>
                      <Link href={`/prototypes/${prototype.id}`}>{prototype.name}</Link>
                    </Primary>
                    <Secondary>{SCOPE_LABELS[prototype.scope]}</Secondary>
                  </Td>
                  <Td label="Personas">{personas.length ? personas.map((persona) => persona.name).join(", ") : <Secondary>None</Secondary>}</Td>
                  <Td label="Version" align="numeric">{`v${prototype.latestNumber}`}</Td>
                  <Td label="Checks">
                    {summary ? (
                      <>
                        <Status state={summary.checks === "passed" ? "checks_passed" : summary.checks === "failed" ? "checks_failed" : "checking"} />
                        <Secondary>{summary.text.replace(/^Checks (passed|failed|running), /, "")}</Secondary>
                      </>
                    ) : (
                      <Secondary>No version</Secondary>
                    )}
                  </Td>
                  <Td label="Template">{template ? <Status state="accepted" /> : <Secondary>Not accepted</Secondary>}</Td>
                  <Td label="Updated">
                    <RelativeTime value={prototype.updatedAt} />
                  </Td>
                </tr>
              );
            })}
          </Table>
        ) : (
          <EmptyState title="No prototypes yet" icon="flask" action={create}>
            Describe what a persona needs, and DE FabLab generates several Salt variants. Keep the ones that work, and each becomes a prototype here.
          </EmptyState>
        )}
      </Panel>
    </Page>
  );
}

function openStatus({ running, undecided, failed, total }: OpenGeneration): { state: string; label: string } {
  if (running > 0) return { state: "checking", label: `Generating: ${total - running} of ${total} finished` };
  if (undecided > 0) return { state: "proposed", label: `${undecided} ${undecided === 1 ? "variant" : "variants"} ready to keep or discard` };
  return { state: "checks_failed", label: failed === 1 ? "The variant failed" : `All ${failed} variants failed` };
}

/**
 * Generations that still need a decision. A generation makes no prototype
 * until one of its variants is kept, so without this a finished generation
 * would seem to vanish from the list.
 */
function OpenGenerations({ open }: { open: readonly OpenGeneration[] }) {
  return (
    <Panel title="Waiting for you" description="Keep a variant to save it as a prototype. Variants you neither keep nor discard stay here." flush>
      <Table
        label="Generations waiting for a decision"
        head={
          <>
            <Th>Generation</Th>
            <Th>Status</Th>
            <Th>Started</Th>
            <Th hidden>Action</Th>
          </>
        }
      >
        {open.map((entry) => {
          const status = openStatus(entry);
          return (
            <tr key={entry.generation.id} data-open-generation={entry.generation.id}>
              <Td label="Generation">
                <Primary>
                  <Link href={`/prototypes/generations/${entry.generation.id}`}>{entry.generation.intent}</Link>
                </Primary>
                <Secondary>{entry.generation.personas.length ? entry.generation.personas.map((persona) => persona.name).join(", ") : "No persona"}</Secondary>
              </Td>
              <Td label="Status">
                <Status state={status.state} label={status.label} />
              </Td>
              <Td label="Started">
                <RelativeTime value={entry.generation.createdAt} />
              </Td>
              <Td label="Action">
                <ButtonLink href={`/prototypes/generations/${entry.generation.id}`} size="sm">
                  {entry.undecided > 0 ? "Review variants" : entry.running > 0 ? "Watch progress" : "See why"}
                </ButtonLink>
              </Td>
            </tr>
          );
        })}
      </Table>
    </Panel>
  );
}
