import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { DeviceControls } from "@/components/preview/device-controls";
import { DeviceFrame, PreviewScale } from "@/components/preview/device-frame";
import { ShellHeader } from "@/components/shell/shell-header";
import { Alert, PageAlerts } from "@/components/ui/alert";
import { ActionButton } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { formatBytes } from "@/components/ui/count";
import { DescriptionList } from "@/components/ui/description-list";
import { Disclosure } from "@/components/ui/disclosure";
import { EmptyState } from "@/components/ui/empty-state";
import { OutcomeToast } from "@/components/ui/outcome-toast";
import { param } from "@/lib/web/query";
import { Page } from "@/components/ui/page";
import { Panel } from "@/components/ui/panel";
import { RelativeTime } from "@/components/ui/relative-time";
import { Section } from "@/components/ui/section";
import { Status } from "@/components/ui/status";
import { ShortValue, Tag } from "@/components/ui/tag";
import { getConfig } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { isPublicId } from "@/lib/db/ids";
import { openPreview } from "@/lib/previews/access";
import type { PackageVerdict } from "@/lib/previews/eligibility";
import { readLogChunk } from "@/lib/previews/log";
import type { ArtifactEntry } from "@/lib/previews/output";
import { type PreviewBuild, settleAbandonedAttempts } from "@/lib/previews/records";
import { previewBasePath } from "@/lib/previews/toolchain";
import { packageLabel, refLabel } from "@/lib/previews/views";
import { DEVICES, ORIENTATION_LABELS, deviceQuery, frameSize, parseDeviceState } from "@/lib/web/device-preview";
import { PREVIEW_OUTCOME_PARAMS, previewOutcome } from "../../../outcomes";
import { deletePreviewAction, rebuildPreview } from "../../../preview-actions";
import { BuildLog } from "./build-log";
import styles from "./preview.module.css";
import { routes } from "@/lib/web/routes";

/** The preview, while its page may be shown: previews on, the preview undeleted, its remote enrolled, and of this Repository. Attempts whose jobs died are settled first. */
const load = cache((sourceId: string, previewId: string) => {
  const db = getDb();
  if (isPublicId(previewId, "pvw")) settleAbandonedAttempts(db, { publicId: previewId });
  const opened = openPreview(db, getConfig(), previewId);
  return opened && opened.source.publicId === sourceId ? opened : null;
});

export async function generateMetadata({ params }: PageProps<"/repositories/[sourceId]/previews/[preview]">): Promise<Metadata> {
  const { sourceId, preview } = await params;
  const opened = load(sourceId, preview);
  return { title: opened ? `Preview ${packageLabel(opened.preview)} · ${opened.source.name}` : "Preview not found" };
}

const TOOL_LABELS = { vite: "Vite", webpack: "webpack", rspack: "Rspack", rsbuild: "Rsbuild" } as const;
/** A microfrontend shows through the page its own build emits, like any other application (design decision 7). */
const MICROFRONTEND_LABELS = { module_federation: "A Module Federation remote, shown through its own page", single_spa: "A single-spa application, shown through its own page" } as const;

/**
 * A repository preview (docs/previews.md, spec "Previews are viewed in a
 * device frame"), a focused page like template preview: the preview's
 * package, ref, and commit with its latest attempt's state, Rebuild, and
 * Delete; the published output's page in a device frame, with the device,
 * Landscape, and Open full screen; and the latest attempt's log, followed
 * live while it's Queued or Building. The published output keeps showing
 * during a rebuild and after one fails. A microfrontend shows through the
 * page its own build emitted, like any other application. The device and
 * orientation live in the address.
 */
export default async function RepositoryPreviewPage({ params, searchParams }: PageProps<"/repositories/[sourceId]/previews/[preview]">) {
  const [{ sourceId, preview: previewId }, query] = await Promise.all([params, searchParams]);
  const opened = load(sourceId, previewId);
  if (!opened) notFound();
  const { preview, source } = opened;
  const device = parseDeviceState(query);
  const size = frameSize(device.device, device.orientation);
  const base = previewBasePath(preview.publicId);
  const name = packageLabel(preview);
  const ref = refLabel(preview);
  const live = preview.attemptState === "queued" || preview.attemptState === "building";
  const entry = preview.artifactEntry === null ? null : (preview.artifactEntry as unknown as ArtifactEntry);
  const log = await readLogChunk(getConfig(), preview);

  return (
    <Page>
      <ShellHeader title={`Preview ${name}`} back={{ href: `${routes.repository(source.publicId)}#previews`, label: `Back to ${source.name}` }} />
      <OutcomeToast outcome={previewOutcome(getDb(), param(query, "notice"), preview.publicId)} strip={PREVIEW_OUTCOME_PARAMS} />

      <div className={styles.workspace}>
        <div className={styles.summary} data-preview-summary="">
          <div className={styles.facts}>
            <span className={styles.name}>{name}</span>
            <span role="status" className={styles.state} data-preview-state="">
              <Status state={preview.attemptState} />
            </span>
            {ref && (
              <span className={styles.fact}>
                {preview.refKind === "tag" ? "Tag" : "Branch"} <Tag>{ref}</Tag>
              </span>
            )}
            <span className={styles.fact}>
              Commit <ShortValue value={preview.commitSha} label="commit" />
            </span>
          </div>
          <div className={styles.actions}>
            {!live && (
              <ActionButton action={rebuildPreview} fields={{ preview: preview.publicId, ...deviceQuery(device) }} size="sm" icon="refresh" aria-label={`Rebuild ${name}`}>
                Rebuild
              </ActionButton>
            )}
            <ConfirmDialog
              action={deletePreviewAction}
              fields={{ preview: preview.publicId }}
              trigger={{ label: "Delete", icon: "trash", variant: "secondary", size: "sm" }}
              title={`Delete the preview of ${name}?`}
              confirmLabel="Delete preview"
              tone="danger"
            >
              {`Its published output and build log are deleted, and ${base} stops answering${live ? ", and the build under way can't publish" : ""}. ${source.name} and its other previews stay.`}
            </ConfirmDialog>
          </div>
        </div>

        <PageAlerts>
          <PreviewAlerts preview={preview} entry={entry} base={base} />
        </PageAlerts>

        {preview.artifact ? (
          <PreviewScale>
            <div className={styles.controls}>
              <DeviceControls action={routes.repositoryPreview(source.publicId, preview.publicId)} state={device} fullScreen={{ href: base, prefix: base, withQuery: true }} />
            </div>
            <DeviceFrame
              key={`${device.device}-${device.orientation}-${preview.artifact}`}
              src={base}
              width={size.width}
              height={size.height}
              title={`${name} on ${DEVICES[device.device].label}, ${ORIENTATION_LABELS[device.orientation]}`}
              address={base}
            />
          </PreviewScale>
        ) : (
          <Panel flush>
            <NothingPublished state={preview.attemptState} />
          </Panel>
        )}

        <Section title="Build log" description={attemptLine(preview)}>
          <BuildLog key={`${preview.attempt}:${log.log ?? ""}`} preview={preview.publicId} attempt={preview.attempt} state={preview.attemptState} initial={log} />
        </Section>

        <Disclosure variant="plain" summary="Details">
          <DescriptionList surface items={details(preview, base)} />
        </Disclosure>
      </div>
    </Page>
  );
}

/** The latest attempt in a sentence: its number, and when it started or finished. */
function attemptLine(preview: PreviewBuild): React.ReactNode {
  if (preview.attemptState === "queued") return `Attempt ${preview.attempt}, waiting for a worker.`;
  if (preview.attemptState === "building")
    return (
      <>
        {`Attempt ${preview.attempt}, started `}
        <RelativeTime value={preview.attemptStartedAt} />.
      </>
    );
  return (
    <>
      {`Attempt ${preview.attempt}, ${preview.attemptState === "ready" ? "ready" : "failed"} `}
      <RelativeTime value={preview.finishedAt} />.
    </>
  );
}

/**
 * What the reader needs to know about what the frame shows: a failed
 * attempt's reason, the earlier output showing while a rebuild runs, and an
 * app whose page was rebased, whose deep links may not work.
 */
function PreviewAlerts({ preview, entry, base }: { preview: PreviewBuild; entry: ArtifactEntry | null; base: string }) {
  const earlier = preview.artifactAttempt !== null && preview.artifactAttempt !== preview.attempt ? preview.artifactAttempt : null;
  return (
    <>
      {preview.attemptState === "failed" && (
        <Alert tone="error" title={`Attempt ${preview.attempt} failed`}>
          {`${preview.attemptReason ?? "The build failed."}${earlier ? ` The output of attempt ${earlier} is still shown.` : ""}`}
        </Alert>
      )}
      {(preview.attemptState === "queued" || preview.attemptState === "building") && earlier && (
        <Alert tone="info" title={`Showing attempt ${earlier}'s output`}>
          {`Attempt ${preview.attempt} replaces it if its build succeeds.`}
        </Alert>
      )}
      {entry?.rebase && (
        <Alert tone="warning" title="Only the page's asset references were rewritten">
          {`The build's index.html refers to assets at the site root, so it's served with them rewritten to ${base}. Scripts, stylesheets, and the app's router aren't rewritten, so some assets may not load and deep links may not work.`}
        </Alert>
      )}
    </>
  );
}

/** What stands in the frame's place until an attempt publishes. */
function NothingPublished({ state }: { state: PreviewBuild["attemptState"] }) {
  if (state === "queued") return <EmptyState title="Waiting for a worker" icon="clock">The build starts when a worker is free. Its log appears below.</EmptyState>;
  if (state === "building") return <EmptyState title="Building" icon="clock">The preview appears here when the build is ready.</EmptyState>;
  return (
    <EmptyState title="Nothing to preview" icon="alert">
      No build of this preview has succeeded. Its log shows why the last one failed.
    </EmptyState>
  );
}

/** How the published output was built, and the preview's identifiers. */
function details(preview: PreviewBuild, base: string): [React.ReactNode, React.ReactNode][] {
  const plan = (preview.decidingFacts as unknown as PackageVerdict).plan;
  return [
    ["Package", <Tag key="package">{preview.packageDir}</Tag>],
    ...(plan
      ? ([
          ["Installs at", <Tag key="root">{plan.installRoot}</Tag>],
          ["Build tool", TOOL_LABELS[plan.buildTool]],
          ...(plan.layout === "standalone" ? [] : [["Microfrontend", MICROFRONTEND_LABELS[plan.layout]]]),
        ] as [React.ReactNode, React.ReactNode][])
      : []),
    ["Published output", preview.artifactAttempt === null ? null : `Attempt ${preview.artifactAttempt}, ${formatBytes(preview.outputBytes ?? 0)}, built in ${Math.max(1, Math.round((preview.buildMs ?? 0) / 1_000))}s`],
    ["Built with", preview.nodeVersion === null ? null : `Node ${preview.nodeVersion}, ${preview.packageManager}`],
    ["Address", <Tag key="address" copy label="address">{base}</Tag>],
    ["Profile digest", <ShortValue key="digest" value={preview.profileDigest} label="digest" />],
    ["ID", <Tag key="id" copy label="ID">{preview.publicId}</Tag>],
  ];
}
