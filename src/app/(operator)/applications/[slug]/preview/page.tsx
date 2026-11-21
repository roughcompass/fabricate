import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ProgressPoller } from "@/components/progress-poller";
import { DeviceControls } from "@/components/preview/device-controls";
import { DeviceFrame, PreviewScale } from "@/components/preview/device-frame";
import { FileTree } from "@/components/preview/file-tree";
import { MockedDeviceFrame, PreviewMocksRelease } from "@/components/preview/preview-mocks";
import { EditorTemplate } from "@/components/templates/editor-template";
import { Alert } from "@/components/ui/alert";
import { CodeBlock } from "@/components/ui/code-block";
import { Select } from "@/components/ui/form";
import { MediaImage } from "@/components/ui/media-card";
import { diagnosticReason } from "@/components/ui/status";
import { SubmitButton } from "@/components/ui/submit-button";
import { TabLink, Tabs } from "@/components/ui/tabs";
import { requireApplications } from "@/lib/applications/availability";
import { type PackageCode, type RefPreview, type SavedPreviewFrame, packageCode, refChoices, refPreview, remoteRefs, savedPreviewState } from "@/lib/applications/preview-mode";
import { type Application, branchLabel, findApplication, statusSnapshot } from "@/lib/applications/records";
import { type SavedPreview, SAVED_PREVIEW_LIMIT, savedPreviewName, savedPreviewOfRef, savedPreviewsOf } from "@/lib/applications/saved-previews";
import { APPLICATION_STATUS_LABELS } from "@/lib/applications/status";
import { getDb } from "@/lib/db/client";
import { resolveActiveSet } from "@/lib/mocks/active";
import { previewBasePath } from "@/lib/previews/toolchain";
import { DEVICES, type DeviceState, ORIENTATION_LABELS, deviceQuery, frameSize, parseDeviceState } from "@/lib/web/device-preview";
import { type SearchParams, param } from "@/lib/web/query";
import { routes } from "@/lib/web/routes";
import { viewedApplication, viewedPreview } from "@/lib/workspaces/access";
import { currentWorkspace } from "@/lib/workspaces/request";
import { ApplicationsPoller } from "../../applications-poller";
import { ApplicationStatusLabel, LogExcerpt, applicationImage, savedPreviewImage } from "../../views";
import { RefFinder, refOptions, remainingPreviews } from "../ref-choice";
import { saveAsPreview, showRef } from "./actions";
import styles from "./preview.module.css";

export async function generateMetadata({ params }: PageProps<"/applications/[slug]/preview">): Promise<Metadata> {
  const application = findApplication(getDb(), (await params).slug);
  return { title: application ? `Preview ${application.name}` : "Application not found" };
}

/**
 * Preview mode's choices, all in the address: the tab, the saved preview by
 * its key or another ref unless it's the tracked branch, the search among
 * refs, the device, its orientation, and the Code tab's file.
 */
interface PreviewState extends DeviceState {
  readonly view: "preview" | "code";
  readonly preview: string | null;
  readonly ref: string | null;
  readonly find: string | null;
  readonly file: string | null;
}

function parseState(params: SearchParams, application: Application): PreviewState {
  const preview = param(params, "preview");
  const ref = param(params, "ref");
  const file = param(params, "file");
  const find = param(params, "find")?.trim().slice(0, 100);
  return {
    view: param(params, "view") === "code" ? "code" : "preview",
    preview: preview && /^[a-z0-9.-]{1,60}$/.test(preview) ? preview : null,
    ref: !preview && ref && /^refs\/(heads|tags)\/./.test(ref) && ref.length <= 266 && ref !== application.trackedRef ? ref : null,
    find: find || null,
    ...parseDeviceState(params),
    file: file && file.length <= 1_024 ? file : null,
  };
}

/** What preview mode's address keeps of what it shows: the saved preview by its key, or another ref. */
function shownQuery(state: Pick<PreviewState, "preview" | "ref">) {
  return { ...(state.preview && { preview: state.preview }), ...(state.ref && { ref: state.ref }) };
}

function hrefOf(slug: string, state: PreviewState): string {
  return routes.applicationPreview(slug, { ...(state.view === "code" && { view: "code" }), ...shownQuery(state), ...(state.view === "preview" && state.find && { find: state.find }), ...deviceQuery(state), ...(state.view === "code" && state.file && { file: state.file }) });
}

/**
 * Preview mode (template-preview spec), a focused page on the Editor
 * template, whose shell header's back button returns to the application: a
 * control row with the Preview and Code tabs and, on the Preview tab, the
 * branch or tag choice, Show, Save as preview while an unsaved ref is shown,
 * the frame's size, the devices, Landscape, and Open full screen. The
 * Preview tab runs the current build, a saved preview's current build, or
 * another ref's build, in a browser window at the device's size; while that
 * build is under way or refused, the frame area says so, and a saved
 * preview's later build is stated in the control row. A `?ref=` that has
 * since been saved opens that saved preview by its key, and a removed key
 * opens the tracked branch with a notice. The Code tab shows the package's
 * committed files at the commit shown. Every choice lives in the address.
 *
 * The frame applies the same mock set as the running application of the
 * build shown, an unsaved branch or tag the tracked branch's, before it
 * loads, and a line above the window names it (add-mock-sets, design
 * decision 16).
 */
export default async function ApplicationPreviewPage({ params, searchParams }: PageProps<"/applications/[slug]/preview">) {
  requireApplications();
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const application = findApplication(getDb(), slug);
  if (!application) notFound();
  const state = parseState(query, application);
  const kept = { ...(state.view === "code" && { view: "code" }), ...deviceQuery(state) };
  const saved = state.preview ? savedPreviewState(getDb(), application, state.preview) : null;
  // A removed preview's address opens the tracked branch, saying so.
  if (state.preview && !saved) redirect(routes.applicationPreview(slug, { ...kept, notice: "removed" }));
  // A ref that has since been saved opens that saved preview, by its key, before the remote is read.
  const savedRef = state.ref ? savedPreviewOfRef(getDb(), application.publicId, state.ref) : undefined;
  if (savedRef) redirect(routes.applicationPreview(slug, { ...kept, preview: savedRef.key, ...(state.find && { find: state.find }) }));
  const listing = await remoteRefs(application, getDb());
  const other = state.ref ? refPreview(getDb(), application, state.ref, listing) : null;
  const savedPreviews = savedPreviewsOf(getDb(), application.publicId);
  const shownBuild = saved ? (saved.frame.kind === "ready" ? saved.frame.build : null) : other ? (other.kind === "ready" ? { preview: other.preview.publicId, commitSha: other.commitSha } : null) : application.current;
  const preview = shownBuild?.preview ?? null;
  const commitSha = saved ? (saved.saved.current?.commitSha ?? saved.saved.latest.commitSha) : other ? ("commitSha" in other ? other.commitSha : null) : (application.current?.commitSha ?? null);
  const selected = saved?.saved.ref ?? state.ref;
  const choices = refChoices(application, listing, { find: state.find, selected, saved: savedPreviews });
  const { tracked } = choices;
  const keep = { ...shownQuery(state), ...(state.find && { find: state.find }) };
  const size = frameSize(state.device, state.orientation);
  const shownRef = saved ? saved.saved.label : branchLabel(state.ref ?? tracked).replace(/^refs\/tags\//, "");
  const unsaved = state.ref !== null;
  const remaining = unsaved ? remainingPreviews(savedPreviews.length) : null;
  const notice = param(query, "notice");
  const base = preview ? previewBasePath(preview) : null;
  // The mock set the build shown applies, by the running application's rules; an unsaved ref takes the tracked branch's.
  const viewed = base ? viewedApplication(getDb(), slug) : null;
  const active = viewed ? resolveActiveSet(getDb(), { applicationId: viewed.id, previewId: saved ? (viewedPreview(getDb(), viewed, saved.saved.key)?.id ?? null) : null, workspaceId: (await currentWorkspace())?.id ?? null }) : null;
  const running = routes.runningApplication(slug, "", undefined, state.preview);
  const fullScreen = base
    ? unsaved
      ? { href: base, prefix: base.replace(/\/$/, ""), withQuery: true, tooltip: "Open full screen without the toolbar. Save as preview runs it with the toolbar." }
      : { href: running, prefix: base.replace(/\/$/, ""), withQuery: true, to: running }
    : undefined;

  return (
    <EditorTemplate focused={{ title: `Preview ${application.name}` }}>
      <div className={styles.workspace}>
        {notice === "unreadable" && (
          <Alert tone="error" title="That branch or tag couldn't be read">
            Nothing was built. Check that the remote is reachable and the branch or tag exists, then try again.
          </Alert>
        )}
        {notice === "removed" && (
          <Alert tone="info" title="That saved preview was removed">
            Preview mode shows the tracked branch instead.
          </Alert>
        )}
        {notice === "limit" && (
          <Alert tone="error" title={`An application can keep ${SAVED_PREVIEW_LIMIT} previews`}>
            Nothing was saved. Remove a preview from the application&apos;s page to save another.
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
                  <Select id="preview-ref" name="ref" label="Branch or tag" hideLabel size="sm" defaultValue={selected ?? tracked} options={refOptions(choices)} />
                  <SubmitButton variant="secondary" size="sm" pendingLabel="Showing">
                    Show
                  </SubmitButton>
                </form>
                {unsaved && (
                  <form action={saveAsPreview.bind(null, slug)} className={styles.refForm}>
                    <input type="hidden" name="ref" value={state.ref!} />
                    <input type="hidden" name="device" value={state.device} />
                    <input type="hidden" name="orientation" value={state.orientation} />
                    <SubmitButton variant="secondary" size="sm" icon="plus" pendingLabel="Saving">
                      Save as preview
                    </SubmitButton>
                  </form>
                )}
                {saved?.frame.kind === "ready" && saved.frame.later && (
                  <span data-later-build="">
                    <ApplicationStatusLabel application={saved.saved} size="sm" />
                  </span>
                )}
                <DeviceControls action={routes.applicationPreview(slug)} state={state} keep={keep} fullScreen={fullScreen} />
              </div>
            )}
          </div>
          {state.view === "preview" && remaining && (
            <p className={styles.muted} role="status" data-remaining-previews="">
              {remaining}
            </p>
          )}
          {state.view === "preview" && <RefFinder action={routes.applicationPreview(slug)} hidden={{ ...shownQuery(state), ...deviceQuery(state) }} choices={choices} clearHref={routes.applicationPreview(slug, { ...shownQuery(state), ...deviceQuery(state) })} />}

          {state.view === "preview" ? (
            preview ? (
              <PreviewFrame
                key={`${state.device}-${state.orientation}-${preview}`}
                slug={slug}
                saved={saved ? saved.saved.key : null}
                mocks={active?.set ?? null}
                base={previewBasePath(preview)}
                width={size.width}
                height={size.height}
                title={`${application.name}, ${shownRef}, on ${DEVICES[state.device].label}, ${ORIENTATION_LABELS[state.orientation]}`}
              />
            ) : saved && saved.frame.kind !== "ready" ? (
              <SavedFrameState application={application} saved={saved.saved} frame={saved.frame} />
            ) : (
              <FrameState application={application} other={other} />
            )
          ) : (
            <CodeView application={application} commitSha={commitSha} preview={preview} state={state} slug={slug} />
          )}
          {saved && (
            <ApplicationsPoller
              url={routes.applicationsStatus([saved.saved.publicId])}
              version={statusSnapshot([{ ...saved.saved, name: savedPreviewName(application.name, saved.saved) }]).version}
              shown={[{ id: saved.saved.publicId, name: savedPreviewName(application.name, saved.saved), label: APPLICATION_STATUS_LABELS[saved.saved.status], settling: saved.saved.settling }]}
            />
          )}
        </PreviewScale>
      </div>
    </EditorTemplate>
  );
}

/**
 * The build shown, running in the device frame at +base+: once the mock set
 * +mocks+ applies to it, when the view has one, under the line that names
 * it; otherwise at once, releasing a worker preview mode armed before.
 */
function PreviewFrame({ slug, saved, mocks, base, ...frame }: { slug: string; saved: string | null; mocks: { publicId: string; name: string; revision: number } | null; base: string; width: number; height: number; title: string }) {
  if (mocks) return <MockedDeviceFrame mocks={{ application: slug, set: mocks.publicId, name: mocks.name, revision: mocks.revision, preview: saved }} base={base} address={base} {...frame} />;
  return (
    <>
      <PreviewMocksRelease slug={slug} preview={saved} base={base} />
      <DeviceFrame src={base} address={base} {...frame} />
    </>
  );
}

/** A saved preview's frame area while it has no successful build: the placeholder while its first build runs, the failure indicator with the reason and its log otherwise. */
function SavedFrameState({ application, saved, frame }: { application: Application; saved: SavedPreview; frame: Exclude<SavedPreviewFrame, { kind: "ready" }> }) {
  const log = saved.latest.build ? `${routes.repositoryPreview(application.repository.publicId, saved.latest.build.preview)}#log` : null;
  return (
    <figure className={styles.state} data-ref-state={frame.kind === "building" ? "building" : "failed"}>
      <MediaImage image={savedPreviewImage(application, saved, "full")} sizes="100vw" />
      <figcaption className={styles.caption} role="status">
        {frame.kind === "building" ? (
          "Building. The frame shows the build once it succeeds."
        ) : (
          <>
            {`${APPLICATION_STATUS_LABELS[frame.status]}: ${frame.reasons.map((reason) => reason.text).join(" ")}`}
            <LogExcerpt lines={frame.reasons[0]?.log} />
            {log && (
              <>
                {" "}
                <Link href={log}>View the build log</Link>
              </>
            )}
          </>
        )}
      </figcaption>
    </figure>
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
  const reason =
    other.kind === "refused"
      ? other.reasons.join(" ")
      : other.kind === "failed" || other.kind === "unknown"
        ? other.reason
        : other.kind === "checking"
          ? "Checking whether this commit can be previewed."
          : other.kind === "unbuilt"
            ? "This commit hasn't been built. Choose Show to build it."
            : "Building. The frame shows the build once it succeeds.";
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
