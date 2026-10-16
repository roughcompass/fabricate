import ts from "typescript";
import type { GateIssue, GateName, GateResult } from "../types";

/** A generated prototype: the component and the sample data module it may import as "./data". */
export interface PrototypeSource {
  readonly code: string;
  readonly data: string;
  /** Whether the version's lineage starts from a hero template, so its component may import `@deweb/portal`. */
  readonly portal?: boolean;
}

/** The portal runtime interface, which only hero lineages may import (design decision 5 of converge-templates-and-prototypes). */
export const PORTAL_MODULE = "@deweb/portal";

/** Whether a version with this provenance may import the portal runtime interface. */
export function portalAllowed(provenance: { readonly hero?: string | null } | null | undefined): boolean {
  return Boolean(provenance?.hero);
}

/**
 * The only modules generated code may import (quality-checks spec, "Generated
 * code uses Salt exclusively"). Salt's data grid is AG Grid with Salt's
 * theme; the theme is a stylesheet the frame always loads, so it isn't
 * imported. Every package here except ./data is in the runtime's import map.
 */
export const ALLOWED_IMPORTS: readonly string[] = ["react", "@salt-ds/core", "@salt-ds/lab", "@salt-ds/icons", "@salt-ds/countries", "@salt-ds/date-components", "ag-grid-react", "ag-grid-community", "./data"];

export const DATA_MODULE = "./data";

/** The global a compiled prototype registers its component under (design.md, decision 8). */
export const PROTOTYPE_GLOBAL = "__fabricatePrototype";

export const PROTOTYPE_FILE = "Prototype.tsx";
export const DATA_FILE = "data.ts";

export function parse(fileName: string, text: string): ts.SourceFile {
  return ts.createSourceFile(fileName, text, ts.ScriptTarget.ES2022, true, fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

/** The 1-based line and column of a position. */
export function position(file: ts.SourceFile, pos: number): { line: number; column: number } {
  const { line, character } = file.getLineAndCharacterOfPosition(pos);
  return { line: line + 1, column: character + 1 };
}

/** Issues in data.ts say so, since their lines are not Prototype.tsx lines. */
export function inFile(file: ts.SourceFile, message: string): string {
  return file.fileName.endsWith(DATA_FILE) ? `${DATA_FILE}: ${message}` : message;
}

export function moduleName(specifier: ts.Expression | undefined): string | null {
  return specifier && ts.isStringLiteral(specifier) ? specifier.text : null;
}

/** A gate's result, failed when it has issues. */
export function result(gate: GateName, started: number, issues: readonly GateIssue[], warnings: readonly GateIssue[] = []): GateResult {
  return { gate, status: issues.length > 0 ? "failed" : "passed", issues, warnings, durationMs: performance.now() - started };
}

export function diagnosticIssue(diagnostic: ts.Diagnostic, symbolAt?: (file: ts.SourceFile, pos: number) => string | undefined): GateIssue {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
  const { file, start } = diagnostic;
  if (!file || start === undefined) return { code: `TS${diagnostic.code}`, message };
  const symbol = symbolAt?.(file, start);
  return { code: `TS${diagnostic.code}`, message: inFile(file, message), ...position(file, start), ...(symbol && { symbol }) };
}
