import { transform } from "lightningcss";
import type { GateIssue } from "../types";
import { STYLES_FILE } from "./common";
import { STYLE_ADVICE, camelProperty, styleValueProblem } from "./style-values";

/**
 * A version's CSS module (prototypes/quality-checks spec, "A CSS module holds
 * only token-based class rules"): parsed with lightningcss for its rules and
 * selectors, and scanned for its declarations, whose values must be Salt
 * tokens. Compiling it scopes each class as `p-<class>-<hash>`, a name that
 * never starts with `salt`, so the frame's inspector never reads it as a Salt
 * component.
 */

export type CssRule = "css-syntax" | "css-selector" | "css-at-rule" | "css-import" | "css-important" | "css-custom-property" | "literal-color" | "literal-length" | "style-value";

/** Rules a module may hold besides class rules. */
const AT_RULES = new Set(["style", "media", "container", "nesting", "nested-declarations"]);
/** Pseudo-classes that take selectors, which must follow the same rules. */
const SELECTOR_PSEUDOS = new Set(["is", "where", "not", "has"]);
const ATTRIBUTE = /^(aria|data)-[a-z0-9-]+$/;
const CLASS_PATTERN = "p-[local]-[hash]";

export interface CssCheck {
  readonly issues: GateIssue[];
  readonly warnings: GateIssue[];
  /** Every class the module defines, in source order. */
  readonly classes: readonly string[];
}

export interface CompiledCss {
  readonly css: string;
  /** Each class the module defines, by its name in the source, to its scoped name. */
  readonly classes: Readonly<Record<string, string>>;
}

const issue = (code: CssRule, line: number, column: number, message: string, symbol?: string): GateIssue => ({ code: `salt-only/${code}`, message: `${STYLES_FILE}: Line ${line} ${message}`, line, column, ...(symbol && { symbol }) });

/** Checks a CSS module's rules, selectors, and values, and lists its classes. */
export function checkCssModule(text: string): CssCheck {
  const issues: GateIssue[] = [];
  let classes: string[] = [];
  try {
    const result = transform({
      filename: STYLES_FILE,
      code: Buffer.from(text),
      cssModules: { pattern: CLASS_PATTERN },
      errorRecovery: false,
      visitor: {
        Rule(rule) {
          const value = ("value" in rule && rule.value ? rule.value : {}) as { loc?: { line: number; column: number }; selectors?: unknown[] };
          const line = (value.loc?.line ?? 0) + 1;
          const column = value.loc?.column ?? 1;
          if (!AT_RULES.has(rule.type)) issues.push(issue("css-at-rule", line, column, `has an @${rule.type} rule; a module holds only class rules, @media, and @container.`, `@${rule.type}`));
          for (const selector of value.selectors ?? []) {
            const problem = selectorProblem(selector as SelectorComponent[]);
            if (problem) issues.push(issue("css-selector", line, column, `uses ${problem}; select only by class, pseudo-class, and aria- or data- attributes.`, problem));
          }
          return undefined;
        },
      },
    });
    classes = Object.keys(result.exports ?? {});
  } catch (error) {
    const loc = (error as { loc?: { line: number; column: number } }).loc;
    issues.push(issue("css-syntax", loc?.line ?? 1, loc?.column ?? 1, `can't be parsed: ${error instanceof Error ? error.message : String(error)}.`));
    return { issues, warnings: [], classes: [] };
  }
  issues.push(...declarationIssues(text));
  return { issues, warnings: [], classes };
}

/** Compiles a checked module: its scoped CSS and the class map the component reads. */
export function compileCssModule(text: string): CompiledCss {
  const result = transform({ filename: STYLES_FILE, code: Buffer.from(text), cssModules: { pattern: CLASS_PATTERN }, minify: true });
  return { css: result.code.toString(), classes: Object.fromEntries(Object.entries(result.exports ?? {}).map(([name, entry]) => [name, entry.name])) };
}

interface SelectorComponent {
  readonly type: string;
  readonly name?: string;
  readonly kind?: string;
  readonly value?: string;
  readonly selector?: SelectorComponent[];
  readonly selectors?: SelectorComponent[][];
}

/** The first part of a selector a module may not use, as written, or null when every part is allowed. */
function selectorProblem(selector: readonly SelectorComponent[]): string | null {
  for (const part of selector) {
    switch (part.type) {
      case "class":
      case "combinator":
      case "nesting":
        continue;
      case "attribute":
        if (!ATTRIBUTE.test(part.name ?? "")) return `the [${part.name}] attribute`;
        continue;
      case "pseudo-class":
        if (part.kind === "global" || part.kind === "local") return `:${part.kind}()`;
        if (SELECTOR_PSEUDOS.has(part.kind ?? "")) {
          for (const inner of part.selectors ?? (part.selector ? [part.selector] : [])) {
            const problem = selectorProblem(inner);
            if (problem) return problem;
          }
        }
        continue;
      case "pseudo-element":
        continue;
      case "type":
        return `the ${part.name} element`;
      case "id":
        return `the #${part.name} id`;
      case "universal":
        return "the universal selector";
      default:
        return `a ${part.type} selector`;
    }
  }
  return null;
}

/** The text with comments blanked, keeping every offset, so line numbers stay true. */
function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "));
}

function lineAt(text: string, offset: number): { line: number; column: number } {
  const before = text.slice(0, offset);
  const line = before.split("\n").length;
  return { line, column: offset - before.lastIndexOf("\n") };
}

/**
 * Every declaration's property and value, scanned from the text: each
 * statement between a `{`, `;`, or `}` and the next `;` or `}` outside
 * parentheses and strings, when it holds a colon at its top level. Block
 * preludes end at `{`, so a selector or an at-rule's condition is never read
 * as a declaration.
 */
function declarationIssues(source: string): GateIssue[] {
  const text = withoutComments(source);
  const issues: GateIssue[] = [];
  const imported = text.search(/@import\b/i);
  if (imported >= 0) {
    const at = lineAt(text, imported);
    issues.push(issue("css-import", at.line, at.column, "imports another stylesheet; a module may not import anything.", "@import"));
  }
  let start = 0;
  let depth = 0;
  let quote: string | null = null;
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!;
    if (quote) {
      if (char === quote && text[index - 1] !== "\\") quote = null;
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === "(") depth++;
    else if (char === ")") depth--;
    else if (depth === 0 && char === "{") start = index + 1;
    else if (depth === 0 && (char === ";" || char === "}")) {
      const statement = text.slice(start, index);
      const colon = topLevelColon(statement);
      const property = colon < 0 ? "" : statement.slice(0, colon).trim();
      if (property && !property.startsWith("@") && !/[\s{}]/.test(property)) {
        const at = lineAt(text, start + statement.search(/\S/));
        issues.push(...declarationProblems(property, statement.slice(colon + 1).trim(), at.line, at.column));
      }
      start = index + 1;
    }
  }
  return issues;
}

function topLevelColon(statement: string): number {
  let depth = 0;
  for (let index = 0; index < statement.length; index++) {
    const char = statement[index];
    if (char === "(") depth++;
    else if (char === ")") depth--;
    else if (char === ":" && depth === 0) return index;
  }
  return -1;
}

function declarationProblems(property: string, value: string, line: number, column: number): GateIssue[] {
  const name = property.toLowerCase();
  if (name.startsWith("--")) return [issue("css-custom-property", line, column, `defines ${name}; use Salt's own tokens instead of new custom properties.`, name)];
  if (name === "composes") return [issue("css-selector", line, column, "uses composes; repeat the class in className instead.", "composes")];
  if (/!\s*important/i.test(value)) return [issue("css-important", line, column, `sets ${name} with !important; Salt's own styles never need overriding by force.`, name)];
  if (/\burl\(/i.test(value)) return [issue("css-import", line, column, `loads ${name} from a URL; a module may not load files.`, name)];
  const problem = styleValueProblem(camelProperty(name), value);
  return problem ? [issue(problem.rule, line, column, `sets ${name} to ${problem.value}; ${STYLE_ADVICE[problem.rule]}`, name)] : [];
}
