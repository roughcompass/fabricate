import Link from "next/link";
import { CodeBlock } from "@/components/ui/code-block";
import { Icon } from "@/components/ui/icon";
import { shellSource } from "@/lib/prototypes/shell-source";
import type { Scope } from "@/lib/prototypes/types";
import styles from "./prototype.module.css";

export interface CodeFile {
  readonly path: string;
  readonly content: string;
  readonly note?: string;
}

/** A version's files: the generated source, its sample data, its CSS module when it has one, and, for a page, the shell's source (sharing-and-export spec, "The code of a version can be read and copied"). */
export function codeFiles(code: string, data: string, scope: Scope, styles: string | null = null): CodeFile[] {
  const files: CodeFile[] = [
    { path: "Prototype.tsx", content: code, note: "Generated, then checked by DE FabLab." },
    { path: "data.ts", content: data, note: "The generation's fictional sample data, shared by its variants." },
  ];
  if (styles?.trim()) files.push({ path: "Prototype.module.css", content: styles, note: "Its CSS module, for what Salt has no property for; it uses only Salt's tokens." });
  if (scope === "page") {
    const shell = shellSource();
    files.push({ path: "PageShell.tsx", content: shell.tsx, note: "The common page shell: the header, navigation, and footer come from here, not from the generated code." }, { path: "PageShell.css", content: shell.css, note: "The shell's styles, which use only Salt's tokens." });
  }
  return files;
}

export function CodeView({ files, selected, hrefFor }: { files: readonly CodeFile[]; selected: string; hrefFor: (path: string) => string }) {
  const file = files.find((entry) => entry.path === selected) ?? files[0]!;
  return (
    <div className={styles.code} data-code-view="">
      <nav className={styles.files} aria-label="Files">
        <ul className={styles.fileList}>
          {files.map((entry) => (
            <li key={entry.path}>
              <Link href={hrefFor(entry.path)} className={styles.file} aria-current={entry.path === file.path ? "true" : undefined} scroll={false}>
                <Icon name="file" size={14} />
                {entry.path}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <div className={styles.source}>
        {file.note && <p className={styles.note}>{file.note}</p>}
        <CodeBlock code={file.content.replace(/\n$/, "")} firstLine={1} label={file.path} />
      </div>
    </div>
  );
}
