import { zipSync, strToU8 } from "fflate";
import { RUNTIME, currentNavItem, shellUser } from "../render";
import { shellSource } from "../shell-source";
import type { PersonaCopy, Scope, ShellConfig } from "../types";

/**
 * One project generator for downloads and Vercel Sandbox (design.md, decision
 * 14; sharing-and-export spec, "A version downloads as a runnable project"):
 * a Vite app pinned to the Salt and React versions DE FabLab renders with,
 * whose entry point renders the version under Salt's provider with the JPM
 * Brand theme, inside the page shell for a page version, as the preview does.
 */

/** The build tooling the project runs with; the rest is pinned to the runtime's own packages. */
export const TOOLING = { vite: "8.3.4", "@vitejs/plugin-react": "6.1.2", typescript: "6.0.3", "@types/react": "19.3.0", "@types/react-dom": "19.3.0" } as const;

/** What a project renders at runtime, besides the generated code: React, Salt, AG Grid, the date library, and the fonts. */
const RUNTIME_PACKAGES = ["react", "react-dom", "@salt-ds/core", "@salt-ds/lab", "@salt-ds/icons", "@salt-ds/countries", "@salt-ds/date-components", "@salt-ds/date-adapters", "@salt-ds/theme", "@salt-ds/ag-grid-theme", "ag-grid-react", "ag-grid-community", "date-fns", "@fontsource/open-sans", "@fontsource/pt-mono"] as const;

export interface ExportedVersion {
  readonly prototypeName: string;
  readonly number: number;
  readonly scope: Scope;
  readonly title: string;
  readonly navItem: string | null;
  readonly code: string;
  readonly data: string;
  /** The version's CSS module, written as src/Prototype.module.css when present. */
  readonly styles?: string | null;
  readonly personas: readonly PersonaCopy[];
  readonly shell: ShellConfig;
}

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "prototype";

/** The archive's name, such as exception-first-queue-v4.zip. */
export function archiveName(prototypeName: string, number: number): string {
  return `${slug(prototypeName)}-v${number}.zip`;
}

function pinned(names: readonly string[]): Record<string, string> {
  const packages = RUNTIME.packages as Record<string, string>;
  return Object.fromEntries(names.map((name) => [name, packages[name]!]));
}

function main(version: ExportedVersion): string {
  const page = version.scope === "page";
  const fonts = ["300", "400", "500", "600", "700"].map((weight) => `import "@fontsource/open-sans/${weight}.css";`).join("\n");
  const body = page
    ? `        <PageShell config={shell} current={${JSON.stringify(currentNavItem(version.shell, version.navItem))}} user={${JSON.stringify(shellUser(version.personas))}}>
          <Prototype />
        </PageShell>`
    : `        <div className="surface">
          <Prototype />
        </div>`;
  return `import { SaltProviderNext } from "@salt-ds/core";
import { AdapterDateFns } from "@salt-ds/date-adapters/date-fns";
import { LocalizationProvider } from "@salt-ds/date-components";
import { AllCommunityModule, ModuleRegistry } from "ag-grid-community";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@salt-ds/theme/index.css";
import "@salt-ds/theme/css/theme-next.css";
import "@salt-ds/ag-grid-theme/salt-ag-theme.css";
${fonts}
import "@fontsource/pt-mono/400.css";
${page ? `import { PageShell } from "./PageShell";\nimport shell from "./shell.json";\n` : ""}import Prototype from "./Prototype";
import "./main.css";

ModuleRegistry.registerModules([AllCommunityModule]);

// Salt's provider with the JPM Brand theme, and Salt's date localization, as DE FabLab's preview renders it.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SaltProviderNext mode="light" density="medium" accent="teal" corner="rounded">
      <LocalizationProvider DateAdapter={AdapterDateFns}>
${body}
      </LocalizationProvider>
    </SaltProviderNext>
  </StrictMode>,
);
`;
}

/** Every file of the project, by path. */
export function projectFiles(version: ExportedVersion): Record<string, string> {
  const name = `${slug(version.prototypeName)}-v${version.number}`;
  const files: Record<string, string> = {
    "package.json": `${JSON.stringify(
      {
        name,
        private: true,
        version: "0.0.0",
        type: "module",
        scripts: { dev: "vite", build: "tsc --noEmit && vite build", preview: "vite preview" },
        dependencies: pinned(RUNTIME_PACKAGES),
        devDependencies: { ...TOOLING },
      },
      null,
      2,
    )}\n`,
    // Vercel Sandbox serves the dev server at a *.vercel.run address, which Vite allows only when named.
    "vite.config.ts": `import react from "@vitejs/plugin-react";\nimport { defineConfig } from "vite";\n\nexport default defineConfig({ plugins: [react()], server: { allowedHosts: [".vercel.run"] } });\n`,
    "tsconfig.json": `${JSON.stringify(
      {
        compilerOptions: { target: "ES2022", lib: ["ES2022", "DOM", "DOM.Iterable"], module: "ESNext", moduleResolution: "bundler", jsx: "react-jsx", strict: true, resolveJsonModule: true, skipLibCheck: true, noEmit: true, types: ["vite/client"] },
        include: ["src"],
      },
      null,
      2,
    )}\n`,
    "index.html": `<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="UTF-8" />\n    <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n    <title>${escapeHtml(version.title || version.prototypeName)}</title>\n  </head>\n  <body>\n    <div id="root"></div>\n    <script type="module" src="/src/main.tsx"></script>\n  </body>\n</html>\n`,
    "src/main.tsx": main(version),
    "src/main.css": "html,\nbody {\n  margin: 0;\n}\n\n.surface {\n  box-sizing: border-box;\n  min-height: 100vh;\n  padding: var(--salt-spacing-300);\n  background: var(--salt-container-primary-background);\n}\n",
    "src/Prototype.tsx": version.code,
    "src/data.ts": version.data,
    "README.md": readme(version, name),
  };
  if (version.styles?.trim()) files["src/Prototype.module.css"] = version.styles;
  if (version.scope === "page") {
    const shell = shellSource();
    files["src/PageShell.tsx"] = shell.tsx;
    files["src/page-shell.css"] = shell.css;
    files["src/shell.json"] = `${JSON.stringify(version.shell, null, 2)}\n`;
  }
  return files;
}

function readme(version: ExportedVersion, name: string): string {
  return [
    `# ${version.prototypeName}, version ${version.number}`,
    "",
    "A prototype generated by AI in DE FabLab Prototypes. Its data is fictional. Don't add client or confidential information.",
    "",
    "## Run it",
    "",
    "```sh",
    "npm install",
    "npm run dev",
    "```",
    "",
    "Then open the address Vite prints, usually http://localhost:5173.",
    "",
    "## What's here",
    "",
    "- `src/Prototype.tsx`: the generated code, as DE FabLab checked it.",
    "- `src/data.ts`: its fictional sample data.",
    ...(version.styles?.trim() ? ["- `src/Prototype.module.css`: its CSS module, which uses only Salt's tokens."] : []),
    ...(version.scope === "page" ? ["- `src/PageShell.tsx` and `src/shell.json`: the common page shell, which provides the header, navigation, and footer. The generated code is only the page body."] : []),
    "- `src/main.tsx`: renders it under Salt's provider with the JPM Brand theme.",
    "",
    `It is pinned to Salt ${RUNTIME.packages["@salt-ds/core"]} and React ${RUNTIME.packages.react}, the versions DE FabLab rendered it with. Package: \`${name}\`.`,
    "",
  ].join("\n");
}

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The project as one zip archive, with its files in a folder named after it. */
export function projectArchive(version: ExportedVersion): Uint8Array {
  const folder = archiveName(version.prototypeName, version.number).replace(/\.zip$/, "");
  const files = projectFiles(version);
  return zipSync(Object.fromEntries(Object.entries(files).map(([path, content]) => [`${folder}/${path}`, strToU8(content)])), { level: 6 });
}
