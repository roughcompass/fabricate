import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ButtonLink } from "@/components/ui/button";
import { CodeBlock } from "@/components/ui/code-block";
import { CopyButton } from "@/components/ui/copy-button";
import { Icon } from "@/components/ui/icon";
import { ShellHeader } from "@/components/shell/shell-header";
import { Page } from "@/components/ui/page";
import { TabLink, Tabs } from "@/components/ui/tabs";
import { ToggleGroup } from "@/components/ui/toggle-group";
import { referenceId, startRoute, templateBySlug } from "@/lib/demo/catalog";
import { referenceUrl } from "@/lib/demo/deployments";
import { requireDemo } from "@/lib/demo/guard";
import { DEVICES, DEVICE_IDS, ORIENTATION_LABELS, type PreviewState, frameSize, parsePreviewState, previewHref, scaffoldCommand, sizeLabel } from "@/lib/demo/preview";
import { type TemplateFile, templateFiles } from "@/lib/demo/template-files";
import { DeviceFrame, FullScreenLink } from "./device-frame";
import { LandscapeToggle } from "./landscape-toggle";
import styles from "./preview.module.css";

type Params = Record<string, string | string[] | undefined>;

const DEVICE_ICONS = { mobile: "smartphone", tablet: "tablet", desktop: "monitor" } as const;

export async function generateMetadata({ params }: { params: Promise<{ templateSlug: string }> }): Promise<Metadata> {
  const template = templateBySlug((await params).templateSlug);
  return { title: template ? `Preview ${template.title}` : "Template not found" };
}

/** The query a choice keeps from the rest of the state. */
function keepFrom(state: PreviewState, omit: "device" | "orientation"): Record<string, string> {
  const keep: Record<string, string> = {};
  if (state.view === "code") keep.view = "code";
  if (omit !== "device") keep.device = state.device;
  if (state.view === "code" && state.file) keep.file = state.file;
  return keep;
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
 * the template. The scaffold command and Deploy template sit above the tabs;
 * the Preview tab shows the reference deployment in a browser window at a
 * device's size, with the device, Landscape, and full-screen controls as
 * icons, and the Code tab shows the template's files. Every choice lives in
 * the address.
 */
export default async function PreviewPage({ params, searchParams }: { params: Promise<{ templateSlug: string }>; searchParams: Promise<Params> }) {
  requireDemo();
  const template = templateBySlug((await params).templateSlug);
  if (!template) notFound();
  const state = parsePreviewState(await searchParams);
  const files = templateFiles(template);
  const file = files.find((entry) => entry.path === state.file) ?? files[0]!;
  const size = frameSize(state.device, state.orientation);
  const reference = `/run/${referenceId(template.slug)}`;
  const route = startRoute(template.app);
  const command = scaffoldCommand(template.slug);
  const action = `/templates/${template.slug}/preview`;

  return (
    <Page>
      <ShellHeader title={`Preview ${template.title}`} back={{ href: `/templates/${template.slug}`, label: `Back to ${template.title}` }} />

      <div className={styles.commandRow}>
        <div className={styles.command} data-scaffold-command="">
          <code className={styles.commandText}>{command}</code>
          <CopyButton value={command} label="Copy command" />
        </div>
        <ButtonLink href={`/templates/${template.slug}/deploy`} variant="primary" size="sm" icon="cloud">
          Deploy template
        </ButtonLink>
      </div>

      <div className={styles.controls}>
        <Tabs label="Preview mode">
          <TabLink href={previewHref(template.slug, { ...state, view: "preview" })} active={state.view === "preview"}>
            Preview
          </TabLink>
          <TabLink href={previewHref(template.slug, { ...state, view: "code" })} active={state.view === "code"}>
            Code
          </TabLink>
        </Tabs>
        {state.view === "preview" && (
          <div className={styles.previewControls}>
            <ToggleGroup action={action} label="Device" name="device" selected={state.device} keep={keepFrom(state, "device")} iconOnly options={DEVICE_IDS.map((id) => ({ value: id, label: DEVICES[id].label, icon: DEVICE_ICONS[id] }))} />
            <LandscapeToggle action={action} orientation={state.orientation} keep={keepFrom(state, "orientation")} />
            <FullScreenLink href={`${reference}/${route.path}`} prefix={reference} />
          </div>
        )}
      </div>

      {state.view === "preview" ? (
        <DeviceFrame
          key={`${state.device}-${state.orientation}`}
          src={`${reference}/${route.path}?embed=1`}
          width={size.width}
          height={size.height}
          title={`${template.title} on ${DEVICES[state.device].label}, ${ORIENTATION_LABELS[state.orientation]}`}
          label={sizeLabel(state.device, state.orientation)}
          address={referenceUrl(template.slug)}
        />
      ) : (
        <div className={styles.code}>
          <FileTree files={files} selected={file.path} hrefFor={(path) => previewHref(template.slug, { ...state, view: "code", file: path })} />
          <div className={styles.source}>
            <CodeBlock code={file.content.replace(/\n$/, "")} firstLine={1} label={file.path} />
          </div>
        </div>
      )}
    </Page>
  );
}
