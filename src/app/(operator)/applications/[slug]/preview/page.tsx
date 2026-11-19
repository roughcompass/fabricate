import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProgressPoller } from "@/components/progress-poller";
import { DeviceControls } from "@/components/preview/device-controls";
import { DeviceFrame, PreviewScale } from "@/components/preview/device-frame";
import { FileTree } from "@/components/preview/file-tree";
import { EditorTemplate } from "@/components/templates/editor-template";
import { Alert } from "@/components/ui/alert";
import { CodeBlock } from "@/components/ui/code-block";
import { Select } from "@/components/ui/form";
import { MediaImage } from "@/components/ui/media-card";
import { diagnosticReason } from "@/components/ui/status";
import { SubmitButton } from "@/components/ui/submit-button";
import { TabLink, Tabs } from "@/components/ui/tabs";
import { requireApplications } from "@/lib/applications/availability";
import { type PackageCode, type RefPreview, packageCode, refChoices, refPreview, remoteRefs } from "@/lib/applications/preview-mode";
import { type Application, branchLabel, findApplication } from "@/lib/applications/records";
import { getDb } from "@/lib/db/client";
import { previewBasePath } from "@/lib/previews/toolchain";
import { DEVICES, type DeviceState, ORIENTATION_LABELS, deviceQuery, frameSize, parseDeviceState } from "@/lib/web/device-preview";
import { type SearchParams, param } from "@/lib/web/query";
import { routes } from "@/lib/web/routes";
import { applicationImage } from "../../views";
import { showRef } from "./actions";
import styles from "./preview.module.css";

export async function generateMetadata({ params }: PageProps<"/applications/[slug]/preview">): Promise<Metadata> {
  const application = findApplication(getDb(), (await params).slug);
  return { title: application ? `Preview ${application.name}` : "Application not found" };
}

/** Preview mode's choices, all in the address: the tab, the ref unless it's the tracked branch, the device, its orientation, and the Code tab's file. */
interface PreviewState extends DeviceState {
  readonly view: "preview" | "code";
  readonly ref: string | null;
  readonly file: string | null;
}

function parseState(params: SearchParams, application: Application): PreviewState {
  const ref = param(params, "ref");
  const file = param(params, "file");
  return {
    view: param(params, "view") === "code" ? "code" : "preview",
    ref: ref && /^refs\/(heads|tags)\/./.test(ref) && ref.length <= 266 && ref !== application.trackedRef ? ref : null,
    ...parseDeviceState(params),
    file: file && file.length <= 1_024 ? file : null,
  };
}

function hrefOf(slug: string, state: PreviewState): string {
  return routes.applicationPreview(slug, { ...(state.view === "code" && { view: "code" }), ...(state.ref && { ref: state.ref }), ...deviceQuery(state), ...(state.view === "code" && state.file && { file: state.file }) });
}

/**
 * Preview mode (template-preview spec), a focused page on the Editor
 * template, whose shell header's back button returns to the application: a
 * control row with the Preview and Code tabs and, on the Preview tab, the
 * branch or tag choice, the frame's size, the devices, Landscape, and Open
 * full screen. The Preview tab runs the current build, or another ref's
 * build, in a browser window at the device's size; while that build is under
 * way or refused, the frame area says so. The Code tab shows the package's
 * committed files at the commit shown. Every choice lives in the address.
 */
export default async function ApplicationPreviewPage({ params, searchParams }: PageProps<"/applications/[slug]/preview">) {
  requireApplications();
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const application = findApplication(getDb(), slug);
  if (!application) notFound();
  const state = parseState(query, application);
  const listing = await remoteRefs(application, getDb());
  const other = state.ref ? refPreview(getDb(), application, state.ref, listing) : null;
  const preview = other ? (other.kind === "ready" ? other.preview.publicId : null) : (application.current?.preview ?? null);
  const commitSha = other ? ("commitSha" in other ? other.commitSha : null) : (application.current?.commitSha ?? null);
  const { tracked, others } = refChoices(application, listing);
  const size = frameSize(state.device, state.orientation);
  const shownRef = branchLabel(state.ref ?? tracked).replace(/^refs\/tags\//, "");

  return (
    <EditorTemplate focused={{ title: `Preview ${application.name}` }}>
      <div className={styles.workspace}>
        {param(query, "notice") === "unreadable" && (
          <Alert tone="error" title="That branch or tag couldn't be read">
            Nothing was built. Check that the remote is reachable and the branch or tag exists, then try again.
          </Alert>
        )}
        <PreviewScale>
          <div className={styles.controls}>
            <Tabs label="Preview mode">
              <TabLink href={hrefOf(slug, { ...state, view: "preview" })} active={state.view === "preview"}>
                Preview
              </TabLink>
              <TabLink href={hrefOf(slug, { ...state, view: "code" })} active={state.view === "code"}>
                Code
              </TabLink>
            </Tabs>
            {state.view === "preview" && (
              <div className={styles.end}>
                <form action={showRef.bind(null, slug)} className={styles.refForm}>
                  <input type="hidden" name="device" value={state.device} />
                  <input type="hidden" name="orientation" value={state.orientation} />
                  <Select
                    id="preview-ref"
                    name="ref"
                    label="Branch or tag"
                    hideLabel
                    size="sm"
                    defaultValue={state.ref ?? tracked}
                    options={[
                      { value: tracked, label: `${branchLabel(tracked)} (tracked)` },
                      { label: "Branches", options: others.filter((ref) => ref.kind === "branch").map((ref) => ({ value: ref.name, label: ref.label })) },
                      { label: "Tags", options: others.filter((ref) => ref.kind === "tag").map((ref) => ({ value: ref.name, label: ref.label })) },
                    ].filter((option) => !("options" in option) || (option.options?.length ?? 0) > 0)}
                  />
                  <SubmitButton variant="secondary" size="sm" pendingLabel="Showing">
                    Show
                  </SubmitButton>
                </form>
                {preview ? (
                  <DeviceControls
                    action={routes.applicationPreview(slug)}
                    state={state}
                    keep={state.ref ? { ref: state.ref } : {}}
                    fullScreen={state.ref ? { href: previewBasePath(preview), prefix: previewBasePath(preview).replace(/\/$/, ""), withQuery: true } : { href: routes.runningApplication(slug), prefix: previewBasePath(preview).replace(/\/$/, ""), withQuery: true, to: routes.runningApplication(slug) }}
                  />
                ) : (
                  <DeviceControls action={routes.applicationPreview(slug)} state={state} keep={state.ref ? { ref: state.ref } : {}} />
                )}
              </div>
            )}
          </div>

          {state.view === "preview" ? (
            preview ? (
              <DeviceFrame
                key={`${state.device}-${state.orientation}-${preview}`}
                src={previewBasePath(preview)}
                width={size.width}
                height={size.height}
                title={`${application.name}, ${shownRef}, on ${DEVICES[state.device].label}, ${ORIENTATION_LABELS[state.orientation]}`}
                address={previewBasePath(preview)}
              />
            ) : (
              <FrameState application={application} other={other} />
            )
          ) : (
            <CodeView application={application} commitSha={commitSha} preview={preview} state={state} slug={slug} />
          )}
        </PreviewScale>
      </div>
    </EditorTemplate>
  );
}

/** The frame area while there's no build to run: the placeholder while one is checked or built, the failure indicator with the reason when it can't be. */
function FrameState({ application, other }: { application: Application; other: RefPreview | null }) {
  const poll = (preparation?: string, preview?: string, version = "") =>
    preparation && <ProgressPoller url={`/api/applications/eligibility?preparation=${preparation}${preview ? `&preview=${preview}` : ""}`} version={version} intervalMs={2_000} />;
  if (!other) {
    // The tracked branch with no successful build yet: the application's own image says how it stands.
    const image = applicationImage(application, "full");
    return (
      <figure className={styles.state}>
        <MediaImage image={image} sizes="100vw" />
        <figcaption className={styles.caption}>{application.latest.outcome === "building" ? "Building. The frame shows the build once it succeeds." : (application.latest.reasons[0]?.text ?? "No build has succeeded yet.")}</figcaption>
      </figure>
    );
  }
  const building = other.kind === "checking" || other.kind === "building" || other.kind === "unbuilt";
  const reason = other.kind === "refused" ? other.reasons.join(" ") : other.kind === "failed" ? other.reason : other.kind === "unknown" ? other.reason : other.kind === "checking" ? "Checking whether this commit can be previewed." : other.kind === "unbuilt" ? "This commit hasn't been built. Choose Show to build it." : "Building. The frame shows the build once it succeeds.";
  return (
    <figure className={styles.state} data-ref-state={other.kind}>
      <MediaImage image={{ state: building ? "building" : "failure" }} sizes="100vw" />
      <figcaption className={styles.caption} role="status">
        {reason}
      </figcaption>
      {other.kind === "checking" && poll(other.preparation.publicId, undefined, `${other.preparation.state}:${other.preparation.requestedAt.getTime()}`)}
      {other.kind === "building" &&
        poll(other.preparation.publicId, other.preview.publicId, `${other.preparation.state}:${other.preparation.requestedAt.getTime()}:${other.preview.attempt}:${other.preview.attemptState}:${other.preview.artifact ?? ""}`)}
    </figure>
  );
}

async function CodeView({ application, commitSha, preview, state, slug }: { application: Application; commitSha: string | null; preview: string | null; state: PreviewState; slug: string }) {
  let code: PackageCode | null = null;
  if (commitSha) {
    try {
      code = await packageCode(application, commitSha, state.file);
    } catch {
      code = null;
    }
  }
  if (!code) {
    return <p className={styles.muted}>{commitSha && !preview ? "This commit's files can be read once it's been checked. Choose Show on the Preview tab to build it." : "No commit has been built yet, so there are no files to show."}</p>;
  }
  return (
    <div className={styles.code}>
      <FileTree
        files={code.files.map((file) => ({ path: file.path, note: file.skipped ? diagnosticReason(file.skipped.reason) : undefined }))}
        selected={code.selected}
        hrefFor={(path) => hrefOf(slug, { ...state, view: "code", file: path })}
      />
      <div className={styles.source}>
        {"text" in code.content ? <CodeBlock code={code.content.text.replace(/\n$/, "")} firstLine={1} label={code.selected} /> : <p className={styles.muted}>{`${code.selected} isn't shown: ${code.content.skipped}`}</p>}
        {code.more > 0 && <p className={styles.muted}>{`The package has ${code.more} more files than the tree lists.`}</p>}
      </div>
    </div>
  );
}
