import ts from "typescript";
import type { GateIssue, GateResult } from "../types";
import { DATA_FILE, DATA_MODULE, PROTOTYPE_FILE, PROTOTYPE_GLOBAL, type PrototypeSource, diagnosticIssue, moduleName, result } from "./common";

/**
 * The build gate (design.md, decisions 7 and 8): `ts.transpileModule` with
 * react-jsx and a transformer, producing one browser module. The sample data
 * is inlined ahead of the component, the component registers itself on
 * `globalThis.__fabricatePrototype` instead of being exported, and package
 * imports stay bare for the frame's import map. Nothing here runs the code.
 */

export const DATA_GLOBAL = "__fabricateData";

export interface BuildOutput {
  readonly result: GateResult;
  /** The browser module, or null when the build failed. */
  readonly compiled: string | null;
}

export function buildGate(source: PrototypeSource): BuildOutput {
  const started = performance.now();
  const issues: GateIssue[] = [];
  let registrations = 0;
  let data: string | null = null;
  let component: string | null = null;
  try {
    const dataOutput = ts.transpileModule(source.data, {
      fileName: DATA_FILE,
      reportDiagnostics: true,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, isolatedModules: true },
    });
    issues.push(...(dataOutput.diagnostics ?? []).map((diagnostic) => diagnosticIssue(diagnostic)));
    data = dataOutput.outputText;

    const componentOutput = ts.transpileModule(source.code, {
      fileName: PROTOTYPE_FILE,
      reportDiagnostics: true,
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, isolatedModules: true },
      transformers: { before: [registerDefaultExport(() => registrations++)] },
    });
    issues.push(...(componentOutput.diagnostics ?? []).map((diagnostic) => diagnosticIssue(diagnostic)));
    component = componentOutput.outputText;
  } catch (error) {
    issues.push({ code: "build/internal", message: `The build failed: ${error instanceof Error ? error.message : String(error)}` });
  }
  if (component !== null && registrations === 0) {
    issues.push({ code: "build/no-component", message: `${PROTOTYPE_FILE} has no default export to register as the prototype component.` });
  }
  const compiled = issues.length === 0 && data !== null && component !== null ? `const ${DATA_GLOBAL} = {};\n(function (exports) {\n${data}\n})(${DATA_GLOBAL});\n${component}` : null;
  return { result: result("build", started, issues), compiled };
}

/**
 * Replaces imports from "./data" with reads of the inlined data, turns the
 * default export into the registration, and drops every other export.
 */
function registerDefaultExport(registered: () => void): ts.TransformerFactory<ts.SourceFile> {
  return (context) => (file) => {
    const { factory } = context;
    const register = (expression: ts.Expression) => {
      registered();
      return factory.createExpressionStatement(factory.createAssignment(factory.createPropertyAccessExpression(factory.createIdentifier("globalThis"), PROTOTYPE_GLOBAL), expression));
    };
    const withoutExport = (modifiers: ts.NodeArray<ts.ModifierLike> | undefined) =>
      modifiers?.filter((modifier) => modifier.kind !== ts.SyntaxKind.ExportKeyword && modifier.kind !== ts.SyntaxKind.DefaultKeyword);
    const isDefault = (node: ts.HasModifiers) => !!ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword);

    const statements: ts.Statement[] = [];
    const trailing: ts.Statement[] = [];
    for (const statement of file.statements) {
      if (ts.isImportDeclaration(statement) && moduleName(statement.moduleSpecifier) === DATA_MODULE) {
        statements.push(...dataBindings(factory, statement));
      } else if (ts.isExportAssignment(statement)) {
        if (!statement.isExportEquals) statements.push(register(statement.expression));
      } else if (ts.isExportDeclaration(statement)) {
        if (statement.isTypeOnly || statement.moduleSpecifier || !statement.exportClause || !ts.isNamedExports(statement.exportClause)) continue;
        for (const element of statement.exportClause.elements) {
          if (element.name.text === "default" && !element.isTypeOnly) trailing.push(register(factory.createIdentifier((element.propertyName ?? element.name).text)));
        }
      } else if (ts.isFunctionDeclaration(statement)) {
        if (isDefault(statement) && statement.body) {
          const name = statement.name ?? factory.createUniqueName("Prototype");
          statements.push(factory.updateFunctionDeclaration(statement, withoutExport(statement.modifiers), statement.asteriskToken, name, statement.typeParameters, statement.parameters, statement.type, statement.body));
          trailing.push(register(name));
        } else {
          statements.push(factory.updateFunctionDeclaration(statement, withoutExport(statement.modifiers), statement.asteriskToken, statement.name, statement.typeParameters, statement.parameters, statement.type, statement.body));
        }
      } else if (ts.isClassDeclaration(statement)) {
        const name = statement.name ?? (isDefault(statement) ? factory.createUniqueName("Prototype") : undefined);
        statements.push(factory.updateClassDeclaration(statement, withoutExport(statement.modifiers), name, statement.typeParameters, statement.heritageClauses, statement.members));
        if (isDefault(statement) && name) trailing.push(register(name));
      } else if (ts.isVariableStatement(statement)) {
        statements.push(factory.updateVariableStatement(statement, withoutExport(statement.modifiers), statement.declarationList));
      } else if (ts.isEnumDeclaration(statement)) {
        statements.push(factory.updateEnumDeclaration(statement, withoutExport(statement.modifiers), statement.name, statement.members));
      } else {
        statements.push(statement);
      }
    }
    return factory.updateSourceFile(file, [...statements, ...trailing]);
  };
}

/** `import d, { a, b as c } from "./data"` as reads of the inlined data; type-only names are dropped. */
function dataBindings(factory: ts.NodeFactory, statement: ts.ImportDeclaration): ts.Statement[] {
  const clause = statement.importClause;
  if (!clause || clause.isTypeOnly) return [];
  const data = () => factory.createIdentifier(DATA_GLOBAL);
  const declare = (name: ts.BindingName, initializer: ts.Expression) =>
    factory.createVariableStatement(undefined, factory.createVariableDeclarationList([factory.createVariableDeclaration(name, undefined, undefined, initializer)], ts.NodeFlags.Const));
  const bindings: ts.Statement[] = [];
  if (clause.name) bindings.push(declare(factory.createIdentifier(clause.name.text), factory.createPropertyAccessExpression(data(), "default")));
  const named = clause.namedBindings;
  if (named && ts.isNamespaceImport(named)) bindings.push(declare(factory.createIdentifier(named.name.text), data()));
  if (named && ts.isNamedImports(named)) {
    const elements = named.elements
      .filter((element) => !element.isTypeOnly)
      .map((element) => factory.createBindingElement(undefined, element.propertyName && (ts.isIdentifier(element.propertyName) ? factory.createIdentifier(element.propertyName.text) : factory.createStringLiteral(element.propertyName.text)), factory.createIdentifier(element.name.text)));
    if (elements.length > 0) bindings.push(declare(factory.createObjectBindingPattern(elements), data()));
  }
  return bindings;
}
