import type { Metadata } from "next";
import { EditorTemplate } from "@/components/templates/editor-template";
import { notFound } from "next/navigation";
import { CodeBlock } from "@/components/ui/code-block";
import { DeviceControls } from "@/components/preview/device-controls";
import { DeviceFrame, PreviewScale } from "@/components/preview/device-frame";
import { FileTree } from "@/components/preview/file-tree";
import { TabLink, Tabs } from "@/components/ui/tabs";
import { referenceId, runPath, startRoute, templateBySlug } from "@/lib/demo/catalog";
import { referenceUrl } from "@/lib/demo/deployments";
import { requireDemo } from "@/lib/demo/guard";
import { parsePreviewState, previewHref } from "@/lib/demo/preview";
import { isIllustrative, templateFiles } from "@/lib/demo/template-files";
import { DEVICES, ORIENTATION_LABELS, frameSize } from "@/lib/web/device-preview";
import styles from "./preview.module.css";

export async function generateMetadata({ params }: PageProps<"/templates/[templateSlug]/preview">): Promise<Metadata> {
  const { templateSlug } = await params;
  const title = templateBySlug(templateSlug)?.title;
  return { title: title ? `Preview ${title}` : "Template not found" };
}

/**
 * Preview mode (template-preview spec), modeled on shadcn blocks: a focused
 * page, with no sidebar or page header, whose header holds a back button to
 * the template. The Preview tab shows the reference deployment in a browser
 * window at a device's size, with the size and the device, Landscape, and
 * full-screen controls on the tabs' row, and the Code tab shows the
 * template's files. Every choice lives in the address.
 */
export default async function PreviewPage({ params, searchParams }: PageProps<"/templates/[templateSlug]/preview">) {
  requireDemo();
  const { templateSlug } = await params;
  const template = templateBySlug(templateSlug);
  if (!template) notFound();
  const state = parsePreviewState(await searchParams);
  const files = templateFiles(template);
  const file = files.find((entry) => entry.path === state.file) ?? files[0]!;
  const size = frameSize(state.device, state.orientation);
  const reference = `/run/${referenceId(template.slug)}`;
  const start = runPath(referenceId(template.slug), startRoute(template.app).path);
  const action = `/templates/${template.slug}/preview`;

  return (
    <EditorTemplate focused={{ title: `Preview ${template.title}` }}>

      <div className={styles.workspace}>
        <PreviewScale>
          <div className={styles.controls}>
            <Tabs label="Preview mode">
              <TabLink href={previewHref(template.slug, { ...state, view: "preview" })} active={state.view === "preview"}>
                Preview
              </TabLink>
              <TabLink href={previewHref(template.slug, { ...state, view: "code" })} active={state.view === "code"}>
                Code
              </TabLink>
            </Tabs>
            {state.view === "preview" && <DeviceControls action={action} state={state} fullScreen={{ href: start, prefix: reference }} />}
          </div>

          {state.view === "preview" ? (
            <DeviceFrame
              key={`${state.device}-${state.orientation}`}
              src={`${start}?embed=1`}
              width={size.width}
              height={size.height}
              title={`${template.title} on ${DEVICES[state.device].label}, ${ORIENTATION_LABELS[state.orientation]}`}
              address={referenceUrl(template.slug)}
            />
          ) : (
            <>
              {isIllustrative(template) && (
                <p className={styles.illustrative} data-illustrative="">
                  These files are illustrative: generated from the template&apos;s description to show its shape, not real Salt.
                </p>
              )}
              <div className={styles.code}>
                <FileTree files={files} selected={file.path} hrefFor={(path) => previewHref(template.slug, { ...state, view: "code", file: path })} />
                <div className={styles.source}>
                  <CodeBlock code={file.content.replace(/\n$/, "")} firstLine={1} label={file.path} />
                </div>
              </div>
            </>
          )}
        </PreviewScale>
      </div>
    </EditorTemplate>
  );
}
