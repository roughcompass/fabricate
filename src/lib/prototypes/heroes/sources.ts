import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import type { SampleData } from "../types";

/**
 * The hand-written heroes hero generation ports to Salt (converge-templates-
 * and-prototypes, design decision 6, as built): each version keeps what its
 * hand-written source shows and does, so the runtime, its toolbar, and their
 * tests work unchanged with Salt underneath. The records come from the
 * hand-written files themselves, without a model, so every region of a hero
 * shows the same data it shows today.
 */

const RUNTIME = path.join(/*turbopackIgnore: true*/ process.cwd(), "src", "demo", "runtime");

/** Each hero's hand-written members, by template slug. */
export const MEMBER_FILES: Readonly<Record<string, string>> = {
  "payments-workspace": "members/payments.tsx",
  "client-onboarding": "members/global-banking.tsx",
  "market-watch": "members/markets.tsx",
  "operations-console": "members/operations.tsx",
};

/** Each shell kind's hand-written source, with the shared parts it uses. */
export const SHELL_FILES: Readonly<Record<"access" | "markets", readonly string[]>> = {
  access: ["access-shell.tsx", "shell-parts.tsx"],
  markets: ["markets-shell.tsx", "shell-parts.tsx"],
};

export function runtimeSource(file: string): string {
  return fs.readFileSync(path.join(RUNTIME, file), "utf8");
}

const parse = (source: string) => ts.createSourceFile("members.tsx", source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
const isUpper = (name: string) => /^[A-Z][A-Z0-9_]*$/.test(name);
const unwrap = (node: ts.Expression): ts.Expression => (ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node) ? unwrap(node.expression) : node);

/**
 * A hero's shared data module, lifted from its hand-written members: every
 * interface and type, and every constant named in capitals whose value is an
 * array of records, exported. Presentation maps, such as tones, stay behind.
 */
export function heroData(source: string, hero: string): SampleData {
  const file = parse(source);
  const parts: string[] = [];
  const names: string[] = [];
  for (const statement of file.statements) {
    if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) {
      parts.push(`export ${statement.getText(file).replace(/^export\s+/, "")}`);
      continue;
    }
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !isUpper(declaration.name.text) || !declaration.initializer) continue;
      if (!ts.isArrayLiteralExpression(unwrap(declaration.initializer))) continue;
      names.push(declaration.name.text);
      parts.push(`export const ${declaration.getText(file)};`);
    }
  }
  return { description: `The records the ${hero} hero shows: ${names.join(", ")}.`, source: `${parts.join("\n\n")}\n` };
}

/** The expression a hand-written file's members map gives one version, such as `PayeeList200` or `() => <TransferForm withReference />`. */
export function versionExpression(source: string, member: string, version: string): string | null {
  const file = parse(source);
  for (const statement of file.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.name.text.endsWith("_MEMBERS") || !declaration.initializer) continue;
      const map = unwrap(declaration.initializer);
      if (!ts.isObjectLiteralExpression(map)) continue;
      const versions = map.properties.find((property): property is ts.PropertyAssignment => ts.isPropertyAssignment(property) && property.name.getText(file).replace(/["']/g, "") === member);
      const object = versions && unwrap(versions.initializer);
      if (!object || !ts.isObjectLiteralExpression(object)) continue;
      const entry = object.properties.find((property): property is ts.PropertyAssignment => ts.isPropertyAssignment(property) && property.name.getText(file).replace(/["']/g, "") === version);
      if (entry) return entry.initializer.getText(file);
    }
  }
  return null;
}
