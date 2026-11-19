import { type Evidence, type JsonObject, type ResolvedEvidence, redactCredentials, resolveEvidence } from "@repo-facts/contract";
import { DetailsTemplate } from "@/components/templates/details-template";
import { Alert } from "@/components/ui/alert";
import type { Crumb } from "@/components/ui/breadcrumbs";
import { CodeBlock } from "@/components/ui/code-block";
import { DescriptionList } from "@/components/ui/description-list";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel } from "@/components/ui/panel";
import { Section } from "@/components/ui/section";
import { ShortValue, Tag } from "@/components/ui/tag";
import { evidenceLocation } from "@/lib/profiles/evidence-locations";
import { openSnapshot } from "@/lib/snapshot/open";

const REFUSALS: Record<string, string> = {
  commit_mismatch: "The stored snapshot is at a different commit than the evidence names.",
  path_missing: "The cited path is not in the pinned snapshot.",
  content_changed: "The cited file's content no longer matches the recorded digest.",
  unreadable: "The cited file could not be read within this deployment's limits.",
  location_invalid: "The cited location is outside the file.",
  excerpt_changed: "The cited lines no longer match the recorded excerpt.",
  id_mismatch: "The evidence record does not match its identifier.",
};

/** Where the cited commit is pinned: the survey's commit in its Repository's mirror. */
export interface EvidencePin {
  repositoryPublicId: string;
  internalRef: string | null;
  commitSha: string;
}

/** Re-reads the cited content from the pinned commit and verifies it; never throws. */
async function resolve(pin: EvidencePin, record: Evidence): Promise<ResolvedEvidence | null> {
  if (!pin.internalRef) return null;
  try {
    return await resolveEvidence(await openSnapshot(pin, { internalRef: pin.internalRef, commitSha: pin.commitSha }), record);
  } catch {
    return null;
  }
}

/**
 * One evidence record of a Profile, with its cited content re-read from the
 * pinned commit and verified against its recorded digests, reached from a
 * Run or from a Profile.
 */
export async function EvidenceView({ breadcrumbs, repository, record: found, pin }: { breadcrumbs: readonly Crumb[]; repository: string; record: JsonObject; pin: EvidencePin }) {
  const record = found as unknown as Evidence;
  const resolved = await resolve(pin, record);
  const firstLine = resolved?.ok && resolved.lines ? resolved.lines.start : null;
  const excerpt = resolved?.ok ? redactCredentials(resolved.excerpt) : "";

  return (
    <DetailsTemplate
      header={{
        breadcrumbs,
        title: evidenceLocation(found),
      }}
      alerts={
        resolved !== null &&
        !resolved.ok && (
          <Alert tone="warning" title="Evidence could not be verified">
            {REFUSALS[resolved.reason] ?? "The cited content could not be verified."} Nothing is shown rather than content that may not be what the detector read.
          </Alert>
        )
      }
    >

      <Section title="Record">
        <DescriptionList
          surface
          items={[
            ["Repository", repository],
            ["Commit", record.commit ? <ShortValue key="commit" value={record.commit} label="commit" /> : "Working tree"],
            ["Path", <Tag key="path" copy label="path">{record.path}</Tag>],
            ["Location", record.location.kind === "lines" ? (record.location.start === record.location.end ? `Line ${record.location.start}` : `Lines ${record.location.start}–${record.location.end}`) : record.location.kind === "pointer" ? <Tag key="pointer">{`${record.location.format} ${record.location.pointer}`}</Tag> : "The entry itself"],
            ["Detector", <Tag key="detector">{record.detector}</Tag>],
            ["Rule", <Tag key="rule">{record.rule}</Tag>],
            ["Object ID", <ShortValue key="object" value={record.object_id} label="object ID" />],
          ]}
        />
      </Section>

      <Section title="Excerpt">
        {resolved === null ? (
          <Panel flush>
            <EmptyState title="Excerpt unavailable" icon="file">
              The pinned snapshot is not in this deployment&apos;s repository storage, so the cited lines cannot be shown. The record above still identifies the exact committed content.
            </EmptyState>
          </Panel>
        ) : !resolved.ok ? (
          <p>No excerpt is shown for unverified evidence.</p>
        ) : record.location.kind === "entry" ? (
          <p>This evidence is the presence, type, or mode of the path itself, so there are no lines to show.</p>
        ) : (
          <div aria-label={`Excerpt of ${record.path}`} role="group">
            <CodeBlock label={record.path} firstLine={firstLine} code={excerpt} />
          </div>
        )}
      </Section>
    </DetailsTemplate>
  );
}
