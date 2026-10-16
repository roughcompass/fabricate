import ts from "typescript";
import { type SaltRegistry, labComponentName, registryRelease, saltRegistry, stableEquivalent, validateSaltUsage } from "../salt/adapter";
import type { GateIssue, GateResult } from "../types";
import { PROTOTYPE_FILE, type PrototypeSource, moduleName, parse, position, result } from "./common";

/**
 * The Salt usage gate (design.md, decision 7): Salt's own usage validator,
 * against the committed registry and the installed release. Only validator
 * errors fail it. Lab components, which the validator does not flag, become
 * warnings (quality-checks spec, "Pre-release Salt components are flagged").
 */

const LAB = "@salt-ds/lab";

/** What the gate runs, replaceable in tests. */
export interface SaltUsageTools {
  readonly registry: () => Promise<SaltRegistry>;
  readonly release: () => string;
  readonly validate: typeof validateSaltUsage;
}

const DEFAULT_TOOLS: SaltUsageTools = { registry: saltRegistry, release: () => registryRelease().release, validate: validateSaltUsage };

export async function saltUsageGate(source: PrototypeSource, tools: Partial<SaltUsageTools> = {}): Promise<GateResult> {
  const started = performance.now();
  const { registry: loadRegistry, release, validate } = { ...DEFAULT_TOOLS, ...tools };
  let registry: SaltRegistry;
  let validation: ReturnType<typeof validateSaltUsage>;
  try {
    registry = await loadRegistry();
    validation = validate(registry, source.code, release());
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      gate: "salt-usage",
      status: "not-run",
      issues: [],
      warnings: [{ code: "salt-usage/not-run", message: `Salt's usage validator could not run, so Salt usage was not checked: ${reason}` }],
      durationMs: performance.now() - started,
    };
  }
  const issues: GateIssue[] = [];
  const warnings: GateIssue[] = [];
  for (const entry of validation.issues) {
    const issue: GateIssue = { code: entry.id, message: `${entry.title}: ${entry.message}`, ...(entry.suggested_fix && { fix: entry.suggested_fix }) };
    (entry.severity === "error" ? issues : warnings).push(issue);
  }
  warnings.push(...labWarnings(registry, source.code));
  return result("salt-usage", started, issues, warnings);
}

/** One warning per lab component the code imports, naming the stable equivalent when Salt has one. */
function labWarnings(registry: SaltRegistry, code: string): GateIssue[] {
  const file = parse(PROTOTYPE_FILE, code);
  const found = new Map<string, ts.Node>();
  const namespaces = new Set<string>();
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || moduleName(statement.moduleSpecifier) !== LAB) continue;
    const clause = statement.importClause;
    if (!clause || clause.isTypeOnly || !clause.namedBindings) continue;
    if (ts.isNamespaceImport(clause.namedBindings)) {
      namespaces.add(clause.namedBindings.name.text);
      continue;
    }
    for (const element of clause.namedBindings.elements) {
      const name = (element.propertyName ?? element.name).text;
      if (!element.isTypeOnly && !found.has(name)) found.set(name, element);
    }
  }
  if (namespaces.size > 0) {
    const visit = (node: ts.Node): void => {
      if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && namespaces.has(node.expression.text) && !found.has(node.name.text)) found.set(node.name.text, node);
      ts.forEachChild(node, visit);
    };
    visit(file);
  }
  return [...found].map(([name, node]) => {
    const equivalent = stableEquivalent(registry, name);
    const message = `${labComponentName(registry, name)} is a pre-release Salt component from ${LAB}.`;
    return {
      code: "salt-usage/lab",
      message: equivalent ? `${message} Use ${equivalent.name} from ${equivalent.package}, which is stable.` : message,
      symbol: name,
      ...position(file, node.getStart(file)),
      ...(equivalent && { fix: `Import ${equivalent.name} from ${equivalent.package} instead of ${name} from ${LAB}.` }),
    };
  });
}
