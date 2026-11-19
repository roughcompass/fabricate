import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CodeBlock } from "@/components/ui/code-block";
import { Icon } from "@/components/ui/icon";
import { DeviceControls } from "@/components/preview/device-controls";
import { DeviceFrame, PreviewScale } from "@/components/preview/device-frame";
import { ShellHeader } from "@/components/shell/shell-header";
import { Page } from "@/components/ui/page";
import { TabLink, Tabs } from "@/components/ui/tabs";
import { referenceId, runPath, startRoute, templateBySlug } from "@/lib/demo/catalog";
import { referenceUrl } from "@/lib/demo/deployments";
import { requireDemo } from "@/lib/demo/guard";
import { parsePreviewState, previewHref } from "@/lib/demo/preview";
import { type TemplateFile, isIllustrative, templateFiles } from "@/lib/demo/template-files";
import { DEVICES, ORIENTATION_LABELS, frameSize } from "@/lib/web/device-preview";
import styles from "./preview.module.css";

type Params = Record<string, string | string[] | undefined>;

export async function generateMetadata({ params }: { params: Promise<{ templateSlug: string }> }): Promise<Metadata> {
  const { templateSlug } = await params;
  const title = templateBySlug(templateSlug)?.title;
  return { title: title ? `Preview ${title}` : "Template not found" };
}

interface TreeNode {
  readonly name: string;
  readonly file?: TemplateFile;
  readonly children: TreeNode[];
}

/** The files as folders and files, in the order the files are listed. */
function treeOf(files: readonly TemplateFile[]): TreeNode[] {
  const root: TreeNode[] = [];
  for (const file of files) {
    const parts = file.path.split("/");
    let level = root;
    parts.slice(0, -1).forEach((folder) => {
      let node = level.find((entry) => entry.name === folder && !entry.file);
      if (!node) level.push((node = { name: folder, children: [] }));
      level = node.children;
    });
    level.push({ name: parts.at(-1)!, file, children: [] });
  }
  return root;
}

function TreeItems({ nodes, selected, hrefFor }: { nodes: readonly TreeNode[]; selected: string; hrefFor: (path: string) => string }) {
  return (
    <ul className={styles.treeList}>
      {nodes.map((node) =>
        node.file ? (
          <li key={node.file.path}>
            <Link href={hrefFor(node.file.path)} className={styles.file} aria-label={node.file.path} aria-current={node.file.path === selected ? "true" : undefined} scroll={false}>
              <Icon name="file" size={14} />
              <span className={styles.fileName}>{node.name}</span>
            </Link>
          </li>
        ) : (
          <li key={node.name}>
            <span className={styles.folder}>
              <Icon name="folder" size={14} />
              {node.name}
            </span>
            <TreeItems nodes={node.children} selected={selected} hrefFor={hrefFor} />
          </li>
        ),
      )}
    </ul>
  );
}

function FileTree({ files, selected, hrefFor }: { files: readonly TemplateFile[]; selected: string; hrefFor: (path: string) => string }) {
  return (
    <nav className={styles.tree} aria-label="Files">
      <TreeItems nodes={treeOf(files)} selected={selected} hrefFor={hrefFor} />
    </nav>
  );
}

/**
 * Preview mode (template-preview spec), modeled on shadcn blocks: a focused
 * page, with no sidebar or page header, whose header holds a back button to
 * the template. The Preview tab shows the reference deployment in a browser
 * window at a device's size, with the size and the device, Landscape, and
 * full-screen controls on the tabs' row, and the Code tab shows the
 * template's files. Every choice lives in the address.
 */
export default async function PreviewPage({ params, searchParams }: { params: Promise<{ templateSlug: string }>; searchParams: Promise<Params> }) {
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
    <Page>
      <ShellHeader title={`Preview ${template.title}`} back={{ href: `/templates/${template.slug}`, label: `Back to ${template.title}` }} />

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
                  These files are illustrative: generated from the catalog to show the template&apos;s shape, not real Salt.
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
    </Page>
  );
}
