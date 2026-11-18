import path from "node:path";
import ts from "typescript";
import type { GateResult } from "../types";
import { DATA_FILE, PROTOTYPE_FILE, type PrototypeSource, diagnosticIssue, result } from "./common";
import { checkCssModule } from "./css-module";

/**
 * The typecheck gate (design.md, decision 7): an in-memory TypeScript program
 * over the two generated files, resolving React, Salt, and the DOM from the
 * installed packages. It is the authority on props, since Salt's registry has
 * no prop data. Library source files are parsed once per instance and the
 * previous program is reused, so later checks skip the parse.
 */

const CHECK_DIR = path.join(/*turbopackIgnore: true*/ process.cwd(), ".prototype-check").split(path.sep).join("/");
const PROTOTYPE_PATH = `${CHECK_DIR}/${PROTOTYPE_FILE}`;
const DATA_PATH = `${CHECK_DIR}/${DATA_FILE}`;
const PORTAL_PATH = `${CHECK_DIR}/deweb-portal.d.ts`;
/** The CSS module's declaration, which `allowArbitraryExtensions` resolves `./Prototype.module.css` to. */
const STYLES_PATH = `${CHECK_DIR}/Prototype.module.d.css.ts`;

/** `@deweb/portal`'s types, in step with src/demo/runtime/portal/types.ts; only hero lineages see them. */
export const PORTAL_DECLARATIONS = `declare module "@deweb/portal" {
  export interface PortalProfile { readonly name: string; readonly persona: string; readonly region: string }
  export interface PortalRoute { readonly path: string; readonly label: string; readonly href: string }
  export interface PortalRoutes { readonly current: PortalRoute; readonly routes: readonly PortalRoute[] }
  export interface PortalApplication { readonly name: string; readonly portal: string; readonly environment: string | null }
  export interface PortalMenuEntry { readonly id: string; readonly parentId: string | null; readonly kind: "group" | "item"; readonly label: string; readonly route: string | null }
  export interface PortalBanner { readonly title: string; readonly description: string; readonly severity: "info" | "warning" | "error"; readonly dismissible: boolean }
  export interface PortalExperience {
    readonly portalName: string;
    readonly logo: { readonly light: string; readonly dark: string; readonly alt: string };
    readonly logoLinksHome: boolean;
    readonly banner: PortalBanner | null;
    readonly headerSlots: readonly string[];
    readonly search: { readonly placeholder: string; readonly shortcut: string } | null;
    readonly notifications: { readonly title: string; readonly showUnread: boolean } | null;
    readonly sidebar: { readonly shown: boolean; readonly menuType: "left" | "flyout"; readonly slots: readonly string[] };
    readonly menu: readonly PortalMenuEntry[];
    readonly footer: { readonly shown: boolean; readonly slots: readonly string[]; readonly copyright: string };
  }
  export function useBus(topic: string, member: string, handler: (payload: unknown) => void): void;
  export function usePublish(member: string): (topic: string, payload: unknown) => void;
  export function useProfile(): PortalProfile;
  export function useRoute(): PortalRoutes;
  export function routeHref(route: PortalRoute): string;
  export function useNavigate(): (route: PortalRoute) => void;
  export function useApplication(): PortalApplication;
  export function useExperience(): PortalExperience;
}
`;

export const TYPECHECK_OPTIONS: ts.CompilerOptions = {
  strict: true,
  noEmit: true,
  jsx: ts.JsxEmit.ReactJSX,
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  lib: ["lib.es2022.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
  types: [],
  skipLibCheck: true,
  esModuleInterop: true,
  isolatedModules: true,
  noUncheckedIndexedAccess: false,
  allowArbitraryExtensions: true,
};

interface Cache {
  readonly files: Map<string, ts.SourceFile | undefined>;
  readonly exists: Map<string, boolean>;
  readonly directories: Map<string, boolean>;
  readonly texts: Map<string, string | undefined>;
  previous?: ts.Program;
}

const cache: Cache = { files: new Map(), exists: new Map(), directories: new Map(), texts: new Map() };

export function typecheckGate(source: PrototypeSource): GateResult {
  const started = performance.now();
  const virtual = new Map([
    [PROTOTYPE_PATH, source.code],
    [DATA_PATH, source.data],
    ...(source.portal ? ([[PORTAL_PATH, PORTAL_DECLARATIONS]] as const) : []),
    ...(source.styles?.trim() ? ([[STYLES_PATH, stylesDeclaration(source.styles)]] as const) : []),
  ]);
  const program = ts.createProgram({ rootNames: [...virtual.keys()], options: TYPECHECK_OPTIONS, host: createHost(virtual), oldProgram: cache.previous });
  cache.previous = program;
  const issues = [PROTOTYPE_PATH, DATA_PATH].flatMap((fileName) => {
    const file = program.getSourceFile(fileName)!;
    return [...program.getSyntacticDiagnostics(file), ...program.getSemanticDiagnostics(file)].map((diagnostic) => diagnosticIssue(diagnostic, symbolAt));
  });
  return result("typecheck", started, issues);
}

/** The CSS module's classes as a typed default export, so reading a class it doesn't define fails like a missing property. */
export function stylesDeclaration(styles: string): string {
  const classes = checkCssModule(styles).classes;
  return `declare const styles: {\n${classes.map((name) => `  readonly ${JSON.stringify(name)}: string;\n`).join("")}};\nexport default styles;\n`;
}

function createHost(virtual: ReadonlyMap<string, string>): ts.CompilerHost {
  const remember = <T>(map: Map<string, T>, key: string, load: () => T): T => {
    if (!map.has(key)) map.set(key, load());
    return map.get(key) as T;
  };
  return {
    getSourceFile(fileName, languageVersion) {
      const text = virtual.get(fileName);
      if (text !== undefined) return ts.createSourceFile(fileName, text, languageVersion, true);
      return remember(cache.files, fileName, () => {
        const content = ts.sys.readFile(fileName);
        return content === undefined ? undefined : ts.createSourceFile(fileName, content, languageVersion);
      });
    },
    getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
    getDefaultLibLocation: () => path.dirname(ts.getDefaultLibFilePath(TYPECHECK_OPTIONS)),
    writeFile: () => {},
    getCurrentDirectory: () => process.cwd(),
    getCanonicalFileName: (fileName) => (ts.sys.useCaseSensitiveFileNames ? fileName : fileName.toLowerCase()),
    useCaseSensitiveFileNames: () => ts.sys.useCaseSensitiveFileNames,
    getNewLine: () => "\n",
    fileExists: (fileName) => virtual.has(fileName) || remember(cache.exists, fileName, () => ts.sys.fileExists(fileName)),
    readFile: (fileName) => virtual.get(fileName) ?? remember(cache.texts, fileName, () => ts.sys.readFile(fileName)),
    directoryExists: (directory) => directory === CHECK_DIR || remember(cache.directories, directory, () => ts.sys.directoryExists(directory)),
    getDirectories: (directory) => ts.sys.getDirectories(directory),
    realpath: (fileName) => (virtual.has(fileName) ? fileName : (ts.sys.realpath?.(fileName) ?? fileName)),
  };
}

/** `Button.color` when the position is inside a JSX attribute, else the identifier there, if any. */
function symbolAt(file: ts.SourceFile, pos: number): string | undefined {
  let node: ts.Node = file;
  for (;;) {
    const child: ts.Node | undefined = node.forEachChild((candidate) => (candidate.getStart(file) <= pos && pos < candidate.getEnd() ? candidate : undefined));
    if (!child) break;
    node = child;
  }
  for (let current: ts.Node | undefined = node; current; current = current.parent) {
    if (ts.isJsxAttribute(current)) {
      const element = current.parent.parent;
      return `${element.tagName.getText(file)}.${current.name.getText(file)}`;
    }
  }
  return ts.isIdentifier(node) || ts.isPrivateIdentifier(node) ? node.text : undefined;
}
