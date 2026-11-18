import ts from "typescript";
import type { AppDefinition, RegionArea } from "@/lib/demo/catalog";
import { STYLES_MODULE } from "../gates/common";

/**
 * Flattening a hero's main route into one page (converge-templates-and-
 * prototypes, design decision 7): a deterministic codemod, with no model,
 * that composes each region's microfrontend at its conformant version into a
 * single page module. Each member's top-level names are prefixed with the
 * member's own, so their helpers can't collide; its default export becomes a
 * local component; imports are merged; and the regions are laid out with
 * Salt's responsive grid by area, in one column below the medium breakpoint.
 * Each member's CSS module joins the page's one module with its classes
 * prefixed the same way, `.selected` becoming `.PayeeList_selected`, and its
 * reads of them renamed to match. The page keeps `./data` as its sample data,
 * and is what Use template, variant 0, and the template's Assessment use.
 */

export interface PageRegion {
  readonly member: string;
  readonly version: string;
  readonly area: RegionArea;
}

export interface FlattenedPage {
  readonly route: string;
  readonly regions: readonly PageRegion[];
  readonly code: string;
  /** The page's CSS module, merged from its members', or null when none has one. */
  readonly styles: string | null;
}

/** A member version's source and its CSS module. */
export interface MemberSource {
  readonly code: string;
  readonly styles: string | null;
}

const pascal = (id: string) => id.replace(/(^|-)([a-z0-9])/g, (_, __, letter: string) => letter.toUpperCase());

interface Imports {
  /** Module, then imported name, then whether only types use it. */
  readonly named: Map<string, Map<string, { local: string; typeOnly: boolean }>>;
  readonly defaults: Map<string, string>;
}

/** The names a statement declares at the top level of its module. */
function declaredNames(statement: ts.Statement): ts.Identifier[] {
  if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement) || ts.isEnumDeclaration(statement)) && statement.name) return [statement.name];
  if (ts.isVariableStatement(statement)) return statement.declarationList.declarations.flatMap((declaration) => (ts.isIdentifier(declaration.name) ? [declaration.name] : []));
  return [];
}

/**
 * One member's module, as a block of the page: its imports recorded into
 * +imports+, every top-level declaration prefixed, `export` dropped, and its
 * default export renamed to +component+. Renaming follows TypeScript's own
 * bindings, so a parameter or property with the same name is left alone.
 */
function memberBlock(code: string, prefix: string, component: string, imports: Imports): string {
  // The local name the member imports its CSS module as, whose reads become the page module's prefixed classes.
  let stylesLocal: ts.Symbol | undefined;
  const fileName = "/member.tsx";
  const file = ts.createSourceFile(fileName, code, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
  const host = ts.createCompilerHost({});
  const program = ts.createProgram({ rootNames: [fileName], options: { jsx: ts.JsxEmit.Preserve, noResolve: true, noLib: true }, host: { ...host, getSourceFile: (name) => (name === fileName ? file : undefined), fileExists: (name) => name === fileName } });
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(fileName)!;

  // The default export: a named function or class declaration, or `export default Name;`.
  let defaultName: string | null = null;
  for (const statement of source.statements) {
    const modifiers = ts.canHaveModifiers(statement) ? (ts.getModifiers(statement) ?? []) : [];
    if (modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword) && (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name) defaultName = statement.name.text;
    if (ts.isExportAssignment(statement) && ts.isIdentifier(statement.expression)) defaultName = statement.expression.text;
  }
  if (!defaultName) throw new Error(`A member has no named default export to compose (${component}).`);

  const renames = new Map<ts.Symbol, string>();
  for (const statement of source.statements) {
    for (const name of declaredNames(statement)) {
      const symbol = checker.getSymbolAtLocation(name);
      if (symbol) renames.set(symbol, name.text === defaultName ? component : `${prefix}_${name.text}`);
    }
  }

  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier) && statement.moduleSpecifier.text === STYLES_MODULE && statement.importClause?.name) stylesLocal = checker.getSymbolAtLocation(statement.importClause.name);
  }

  const edits: { start: number; end: number; text: string }[] = [];
  const visit = (node: ts.Node) => {
    if (stylesLocal && (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) && ts.isIdentifier(node.expression) && checker.getSymbolAtLocation(node.expression) === stylesLocal) {
      const key = ts.isPropertyAccessExpression(node) ? node.name.text : ts.isStringLiteralLike(node.argumentExpression) ? node.argumentExpression.text : null;
      if (key !== null) {
        edits.push({ start: node.getStart(source), end: node.getEnd(), text: `styles[${JSON.stringify(`${prefix}_${key}`)}]` });
        return;
      }
    }
    if (ts.isIdentifier(node)) {
      const symbol = checker.getSymbolAtLocation(node);
      const parent = node.parent;
      // A shorthand property keeps its key: `{ name }` becomes `{ name: prefixed }`.
      const renamed = symbol && (renames.get(symbol) ?? (ts.isShorthandPropertyAssignment(parent) ? renames.get(checker.getShorthandAssignmentValueSymbol(parent)!) : undefined));
      if (renamed) edits.push({ start: node.getStart(source), end: node.getEnd(), text: ts.isShorthandPropertyAssignment(parent) ? `${node.text}: ${renamed}` : renamed });
    }
    ts.forEachChild(node, visit);
  };

  const kept: string[] = [];
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement)) {
      if (ts.isStringLiteral(statement.moduleSpecifier) && statement.moduleSpecifier.text === STYLES_MODULE) continue;
      recordImport(statement, imports);
      continue;
    }
    if (ts.isExportAssignment(statement)) continue;
    edits.length = 0;
    visit(statement);
    let text = statement.getText(source);
    const offset = statement.getStart(source);
    for (const edit of [...edits].sort((left, right) => right.start - left.start)) text = text.slice(0, edit.start - offset) + edit.text + text.slice(edit.end - offset);
    kept.push(text.replace(/^export\s+(default\s+)?/, ""));
  }
  return kept.join("\n\n");
}

function recordImport(statement: ts.ImportDeclaration, imports: Imports): void {
  if (!ts.isStringLiteral(statement.moduleSpecifier) || !statement.importClause) return;
  const specifier = statement.moduleSpecifier.text === "../data" ? "./data" : statement.moduleSpecifier.text;
  const clause = statement.importClause;
  if (clause.name) imports.defaults.set(specifier, clause.name.text);
  const bindings = clause.namedBindings;
  if (!bindings || !ts.isNamedImports(bindings)) return;
  const named = imports.named.get(specifier) ?? new Map<string, { local: string; typeOnly: boolean }>();
  imports.named.set(specifier, named);
  for (const element of bindings.elements) {
    const imported = (element.propertyName ?? element.name).text;
    const typeOnly = clause.isTypeOnly || element.isTypeOnly;
    const previous = named.get(imported);
    named.set(imported, { local: element.name.text, typeOnly: previous ? previous.typeOnly && typeOnly : typeOnly });
  }
}

function importLines(imports: Imports): string[] {
  const modules = [...new Set([...imports.named.keys(), ...imports.defaults.keys()])].sort((left, right) => Number(left.startsWith(".")) - Number(right.startsWith(".")) || left.localeCompare(right));
  return modules.map((specifier) => {
    const named = [...(imports.named.get(specifier) ?? new Map()).entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([imported, { local, typeOnly }]) => `${typeOnly ? "type " : ""}${imported === local ? imported : `${imported} as ${local}`}`);
    const parts = [imports.defaults.get(specifier), named.length ? `{ ${named.join(", ")} }` : null].filter(Boolean);
    return `import ${parts.join(", ")} from ${JSON.stringify(specifier)};`;
  });
}

const SPAN: Record<RegionArea, (hasSide: boolean) => number> = { main: (hasSide) => (hasSide ? 2 : 3), side: () => 1, wide: () => 3 };

/** A member's CSS module with every class prefixed, as the page's module holds it. */
export function prefixedStyles(styles: string, prefix: string): string {
  return styles.replace(/\.(-?[_a-zA-Z][\w-]*)/g, (_, name: string) => `.${prefix}_${name}`);
}

/**
 * The hero's main route as one page: each region's member at the version
 * +versionOf+ names, by area, from +sources+ (member, then version, then code).
 */
export function flattenMainRoute(app: AppDefinition, title: string, versionOf: (member: string) => string, sourceOf: (member: string, version: string) => MemberSource): FlattenedPage {
  const route = app.routes[0]!;
  const imports: Imports = { named: new Map([["@salt-ds/core", new Map([["GridItem", { local: "GridItem", typeOnly: false }], ["GridLayout", { local: "GridLayout", typeOnly: false }]])]]), defaults: new Map() };
  const regions = route.regions.map(({ member, area }) => ({ member, version: versionOf(member), area }));
  const sources = regions.map((region) => ({ region, source: sourceOf(region.member, region.version) }));
  const blocks = sources.map(({ region, source }) => memberBlock(source.code, pascal(region.member), pascal(region.member), imports));
  const modules = sources.filter(({ source }) => source.styles?.trim()).map(({ region, source }) => `/* ${region.member} ${region.version} */\n${prefixedStyles(source.styles!.trim(), pascal(region.member))}`);
  const styles = modules.length ? `${modules.join("\n\n")}\n` : null;
  const hasSide = regions.some((region) => region.area === "side");
  const page = pascal(title.replace(/[^A-Za-z0-9]+/g, "-").toLowerCase());
  const code = [
    `// ${title}: the ${route.label} route as one page, composed from its microfrontends at their conformant versions:`,
    ...regions.map((region) => `// ${region.member} ${region.version} (${region.area})`),
    ...importLines(imports),
    ...(styles ? [`import styles from ${JSON.stringify(STYLES_MODULE)};`] : []),
    "",
    blocks.join("\n\n"),
    "",
    `export default function ${page}() {`,
    "  return (",
    "    <GridLayout columns={{ xs: 1, md: 3 }} gap={3}>",
    ...regions.map((region) => `      <GridItem colSpan={{ xs: 1, md: ${SPAN[region.area](hasSide)} }}>\n        <${pascal(region.member)} />\n      </GridItem>`),
    "    </GridLayout>",
    "  );",
    "}",
    "",
  ].join("\n");
  return { route: route.path, regions, code, styles };
}
