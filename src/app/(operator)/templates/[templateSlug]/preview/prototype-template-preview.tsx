import { AiNotice } from "@/components/prototypes/ai-notice";
import { PreviewControls } from "@/components/prototypes/preview-controls";
import { VersionPreview } from "@/components/prototypes/version-preview";
import { ShellHeader } from "@/components/shell/shell-header";
import { Alert } from "@/components/ui/alert";
import { Page } from "@/components/ui/page";
import { type FramePreview } from "@/lib/prototypes/preview-state";
import { failingGates } from "@/lib/prototypes/rechecks";
import type { AcceptedTemplate } from "@/lib/prototypes/templates";
import styles from "./preview.module.css";

/**
 * Preview template for a template accepted from a prototype: a focused page
 * whose parent is the template, with its latest version in the common page
 * shell under the prototype preview controls. Nothing it renders is reported
 * back, since the version belongs to the workspace that accepted it. When the
 * latest re-check couldn't compile the code for the current runtime build, the
 * failures show instead (design.md, decision 17).
 */
export function PrototypeTemplatePreview({ template, state }: { template: AcceptedTemplate; state: FramePreview }) {
  const frameBase = `/prototypes/render/template/${template.id}`;
  const { latest, recheck } = template;
  const unbuilt = recheck?.status === "broken" && !recheck.compiled;
  return (
    <Page>
      <ShellHeader title={`Preview ${latest.title}`} back={{ href: `/templates/${template.slug}`, label: `Back to ${latest.title}` }} />
      <div className={styles.prototypePreview}>
        <AiNotice />
        {unbuilt ? (
          <Alert tone="error" title={`It doesn't build on Salt ${recheck.saltRelease}`}>
            {failingGates(recheck)
              .flatMap((result) => result.issues)
              .map((issue) => (issue.line ? `Line ${issue.line}: ${issue.message}` : issue.message))
              .join(" ")}
          </Alert>
        ) : (
          <>
            <PreviewControls action={`/templates/${template.slug}/preview`} state={state} frameBase={frameBase} />
            <VersionPreview versionId={latest.snapshot.versionId} title={latest.title} state={state} frameBase={frameBase} report={false} />
          </>
        )}
      </div>
    </Page>
  );
}
