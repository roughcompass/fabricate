import Link from "next/link";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel } from "@/components/ui/panel";
import { RelativeTime } from "@/components/ui/relative-time";
import { Section } from "@/components/ui/section";
import { Status } from "@/components/ui/status";
import { Primary, Secondary, Table, Td, Th } from "@/components/ui/table";
import { getDb } from "@/lib/db/client";
import { applicationName, inferRendering, launchDraftSchema, renderingCompatibility, silentEvidence } from "@/lib/onboarding/applications";
import { RENDERING_MODE_LABELS } from "@/lib/onboarding/documents";
import { type Microfrontend, type MicrofrontendDraft, draftRendering } from "@/lib/onboarding/microfrontends";

const SOURCE_LABELS = { mfe_contract: "Submitted rendering metadata", studio: "Studio module type", cdaas: "CDaaS" } as const;

/**
 * Beside the rendering step: whether each Application that uses the MFE now
 * could still load it with the Draft's rendering metadata, and the evidence
 * Applications launching the MFE infer a rendering mode from.
 */
export function RenderingEvidence({ mfe, document }: { mfe: Microfrontend; document: MicrofrontendDraft }) {
  const db = getDb();
  const rendering = draftRendering(document);
  const bindings = rendering ? renderingCompatibility(db, mfe, rendering) : [];
  const { candidates } = inferRendering(db, launchDraftSchema.parse({ kind: "mfe", microfrontend: mfe.publicId }));
  const silent = silentEvidence(db, { kind: "mfe", microfrontend: mfe.publicId });

  return (
    <>
      <Section title="Applications using it" description="Each Application that uses the MFE now, as its entry or as a child, and whether this Draft still offers the mode and module it uses.">
        <Panel flush>
          {!rendering ? (
            <EmptyState title="Not checked yet">Say how at least one rendering mode loads the MFE, then save, to check the Applications that use it.</EmptyState>
          ) : bindings.length === 0 ? (
            <EmptyState title="No Application uses this MFE yet">Each Application that binds it is checked against its rendering metadata when it&apos;s submitted.</EmptyState>
          ) : (
            <Table
              label="Applications using it"
              head={
                <>
                  <Th>Application</Th>
                  <Th>Uses</Th>
                  <Th>Result</Th>
                </>
              }
            >
              {bindings.map((binding) => (
                <tr key={`${binding.application.publicId}-${binding.role}-${binding.uses}`}>
                  <Td label="Application">
                    <Primary>
                      <Link href={`/onboarding/applications/${binding.application.publicId}`}>{applicationName(binding.application)}</Link>
                    </Primary>
                    <Secondary>{`Revision ${binding.revision} · ${binding.role === "entry" ? "Entry" : "Child"}`}</Secondary>
                  </Td>
                  <Td label="Uses">{binding.uses}</Td>
                  <Td label="Result">
                    {binding.issues.length === 0 ? (
                      <Status state="pass" label="Still offered" />
                    ) : (
                      <>
                        <Status state="fail" label="No longer offered" />
                        <ul>
                          {binding.issues.map((issue) => (
                            <li key={`${issue.code}-${issue.message}`}>{issue.message}</li>
                          ))}
                        </ul>
                      </>
                    )}
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </Panel>
      </Section>
      <Section title="Rendering evidence" description="The rendering modes the evidence proposes to Applications launching this MFE, and where each comes from. Each Application confirms or overrides its own.">
        <Panel flush>
          {candidates.length > 0 ? (
            <Table
              label="Rendering evidence"
              head={
                <>
                  <Th>Mode</Th>
                  <Th>Proposed by</Th>
                  <Th>Observed</Th>
                </>
              }
            >
              {candidates.map((candidate) => (
                <tr key={candidate.key}>
                  <Td label="Mode">
                    {RENDERING_MODE_LABELS[candidate.mode]}
                    {candidate.module && <Secondary mono>{candidate.module}</Secondary>}
                  </Td>
                  <Td label="Proposed by">
                    {SOURCE_LABELS[candidate.source]}
                    <Secondary>{candidate.evidence}</Secondary>
                  </Td>
                  <Td label="Observed">
                    <RelativeTime value={candidate.observedAt} />
                  </Td>
                </tr>
              ))}
            </Table>
          ) : (
            <EmptyState title="No evidence yet">Proposals come from the submitted rendering metadata and the type of the Studio module the MFE is mapped to.</EmptyState>
          )}
        </Panel>
        {silent.map((message) => (
          <Secondary key={message}>{`${message}.`}</Secondary>
        ))}
      </Section>
    </>
  );
}
