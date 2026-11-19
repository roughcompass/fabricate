import Link from "next/link";
import { Icon } from "@/components/ui/icon";
import styles from "./file-tree.module.css";

/** A file the tree lists: its path, and a short note, such as why it isn't shown. */
export interface TreeFile {
  readonly path: string;
  readonly note?: string;
}

interface TreeNode {
  readonly name: string;
  readonly file?: TreeFile;
  readonly children: TreeNode[];
}

/** The files as folders and files, in the order the files are listed. */
function treeOf(files: readonly TreeFile[]): TreeNode[] {
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
            <Link href={hrefFor(node.file.path)} className={styles.file} aria-label={node.file.note ? `${node.file.path}, ${node.file.note}` : node.file.path} aria-current={node.file.path === selected ? "true" : undefined} scroll={false}>
              <Icon name="file" size={14} />
              <span className={styles.fileName}>{node.name}</span>
              {node.file.note && <span className={styles.note}>{node.file.note}</span>}
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

/** A code view's files as a tree of links, the selected one current; preview mode's Code tab shows it beside the file. */
export function FileTree({ files, selected, hrefFor }: { files: readonly TreeFile[]; selected: string; hrefFor: (path: string) => string }) {
  return (
    <nav className={styles.tree} aria-label="Files">
      <TreeItems nodes={treeOf(files)} selected={selected} hrefFor={hrefFor} />
    </nav>
  );
}
