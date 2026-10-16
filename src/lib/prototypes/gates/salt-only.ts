import ts from "typescript";
import type { GateIssue, GateResult } from "../types";
import { ALLOWED_IMPORTS, DATA_FILE, DATA_MODULE, PORTAL_MODULE, PROTOTYPE_FILE, type PrototypeSource, inFile, moduleName, parse, position, result } from "./common";

/**
 * The Salt-only gate (design.md, decision 7; quality-checks spec, "Generated
 * code uses Salt exclusively"): a walk of the syntax tree of both files. It
 * never resolves types; the typecheck gate does that.
 */

export type SaltOnlyRule =
  | "import"
  | "style-value"
  | "literal-color"
  | "literal-length"
  | "class-name"
  | "style-element"
  | "inner-html"
  | "provider"
  | "default-export"
  | "network"
  | "storage"
  | "window-open"
  | "eval"
  | "external-asset";

/** The host renders every prototype inside these (design.md, decision 8). */
const PROVIDERS = new Set(["SaltProvider", "SaltProviderNext", "UNSTABLE_SaltProviderNext", "LocalizationProvider", "CSPProvider"]);
const FORBIDDEN_ELEMENTS = new Set(["style", "link", "script", "iframe", "object", "embed"]);
const ASSET_ATTRIBUTES = new Set(["src", "href", "srcSet", "srcset", "poster", "xlinkHref", "xlink:href"]);
const AG_THEME_CLASS = /^ag-theme-salt(-[a-z0-9]+)*$/;
const SALT_VAR = /^var\(\s*--salt-[a-z0-9-]+\s*(,\s*var\(\s*--salt-[a-z0-9-]+\s*\)\s*)?\)$/i;
const EXTERNAL_URL = /^(https?:|\/\/)/i;

type ApiRule = "network" | "storage" | "window-open" | "eval";

/** Globals generated code may not reference, by the rule they break. */
const GLOBALS = new Map<string, ApiRule>([
  ["fetch", "network"],
  ["XMLHttpRequest", "network"],
  ["WebSocket", "network"],
  ["EventSource", "network"],
  ["localStorage", "storage"],
  ["sessionStorage", "storage"],
  ["indexedDB", "storage"],
  ["caches", "storage"],
  ["cookieStore", "storage"],
  ["eval", "eval"],
]);
const MEMBERS = new Map<string, ApiRule>([
  ["navigator.sendBeacon", "network"],
  ["document.cookie", "storage"],
]);
/** Names that reach the global scope, so `window.fetch` is `fetch`. */
const GLOBAL_OBJECTS = new Set(["window", "globalThis", "self", "top", "parent", "frames"]);

const API_MESSAGES: Record<ApiRule, (symbol: string) => string> = {
  network: (symbol) => `Prototypes run without network access; remove ${symbol} and use the sample data in ./data.`,
  storage: (symbol) => `Prototypes may not use browser storage or cookies; remove ${symbol} and keep state in React.`,
  "window-open": (symbol) => `Prototypes may not open windows; remove ${symbol}.`,
  eval: (symbol) => `Prototypes may not evaluate or load code at run time; remove ${symbol}.`,
};

/** Unitless CSS properties, where a number is a count or a ratio rather than a size. */
const UNITLESS = new Set(["flex", "flexGrow", "flexShrink", "opacity", "zIndex", "order", "gridRow", "gridColumn", "gridRowStart", "gridRowEnd", "gridColumnStart", "gridColumnEnd", "columnCount", "aspectRatio"]);

/** Typography comes from Salt's Text and its tokens, never from literal values (quality-checks spec, "Generated code uses Salt exclusively"). */
const TYPOGRAPHY = new Set(["font", "fontFamily", "fontSize", "fontWeight", "fontStyle", "lineHeight", "letterSpacing"]);

/** A CSS keyword or several, such as "flex", "right", or "space-between": neither a color, a size, nor a font. */
const KEYWORDS = /^[a-z]+(-[a-z]+)*( [a-z]+(-[a-z]+)*)*$/i;

/** calc() over Salt tokens and plain numbers, as Salt's own examples size things: calc(var(--salt-size-base) * 2). */
const TOKEN_CALC = /^calc\([\s\d.+\-*/()]*\)$/;

const NAMED_COLORS = new Set(
  (
    "black white red green blue yellow orange purple pink brown gray grey navy teal silver gold maroon olive lime aqua cyan magenta fuchsia indigo violet " +
    "coral salmon crimson tomato turquoise beige ivory khaki lavender tan plum orchid chocolate firebrick darkred darkblue darkgreen darkgray darkgrey " +
    "darkorange lightgray lightgrey lightblue lightgreen lightyellow whitesmoke gainsboro slategray slategrey steelblue royalblue skyblue dodgerblue " +
    "midnightblue forestgreen seagreen goldenrod rebeccapurple transparent currentcolor"
  ).split(" "),
);
const HEX_COLOR = /#[0-9a-f]{3,8}\b/i;
const COLOR_FUNCTION = /\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i;
const LENGTH = /(^|[^\w.-])-?(\d+\.?\d*|\.\d+)(px|rem|em|%|vh|vw|vmin|vmax|dvh|dvw|svh|svw|lvh|lvw|ch|ex|pt|pc|cm|mm|in|fr)(?![\w-])/i;

export function saltOnlyGate(source: PrototypeSource): GateResult {
  const started = performance.now();
  const issues: GateIssue[] = [];
  checkFile(parse(PROTOTYPE_FILE, source.code), true, issues, source.portal === true);
  checkFile(parse(DATA_FILE, source.data), false, issues, false);
  return result("salt-only", started, issues);
}

function checkFile(file: ts.SourceFile, isComponent: boolean, issues: GateIssue[], portal: boolean): void {
  const local = declaredNames(file);
  const defaults: ts.Node[] = [];
  const add = (node: ts.Node, rule: SaltOnlyRule, message: (line: number) => string, symbol?: string) => {
    const at = position(file, node.getStart(file));
    issues.push({ code: `salt-only/${rule}`, message: inFile(file, message(at.line)), ...at, ...(symbol && { symbol }) });
  };

  const checkSpecifier = (node: ts.Node, specifier: string | null, typeOnly: boolean) => {
    if (specifier === null) return;
    if (specifier === PORTAL_MODULE && !(portal && isComponent)) {
      add(node, "import", () => `"${PORTAL_MODULE}" is only for pages that start from a hero template; use React state and the sample data in ./data instead.`, specifier);
    } else if (specifier === PORTAL_MODULE) {
      return;
    } else if (!ALLOWED_IMPORTS.includes(specifier) || (!isComponent && specifier === DATA_MODULE)) {
      add(node, "import", () => `Only React and Salt may be imported; "${specifier}" is not allowed.`, specifier);
    } else if (!isComponent && !typeOnly) {
      add(node, "import", () => `The sample data module may only import types; "${specifier}" is imported for values.`, specifier);
    }
  };

  const checkApi = (node: ts.Node, path: readonly string[] | null) => {
    if (!path || path.length === 0 || local.has(path[0]!)) return;
    const viaGlobal = GLOBAL_OBJECTS.has(path[0]!);
    const rest = dropGlobalObjects(path);
    if (rest.length === 0) return;
    const joined = rest.join(".");
    if (MEMBERS.has(joined)) return add(node, MEMBERS.get(joined)!, () => API_MESSAGES[MEMBERS.get(joined)!](joined), joined);
    if (!viaGlobal || rest.length !== 1) return;
    if (joined === "open") return add(node, "window-open", () => API_MESSAGES["window-open"]("window.open"), "window.open");
    const rule = GLOBALS.get(joined);
    if (rule) add(node, rule, () => API_MESSAGES[rule](joined), joined);
  };

  const checkAttribute = (attribute: ts.JsxAttribute) => {
    const name = attributeName(attribute);
    if (name === "style") return checkStyle(attribute);
    if (name === "className" || name === "class") {
      const value = stringValue(attribute.initializer)?.trim();
      if (!value || !value.split(/\s+/).every((entry) => AG_THEME_CLASS.test(entry))) {
        add(attribute, "class-name", (line) => `Line ${line} sets ${name}; only AG Grid's Salt theme classes, such as ag-theme-salt, may be used. Style with Salt components, their properties, and tokens.`, "className");
      }
      return;
    }
    if (name === "dangerouslySetInnerHTML") return add(attribute, "inner-html", (line) => `Line ${line} uses dangerouslySetInnerHTML; render content with Salt components instead.`, name);
    if (ASSET_ATTRIBUTES.has(name)) {
      const value = stringValue(attribute.initializer)?.trim();
      if (value && EXTERNAL_URL.test(value)) add(attribute, "external-asset", (line) => `Line ${line} loads ${value} from outside DE FabLab; prototypes may not load external assets.`, name);
    }
  };

  const checkStyle = (attribute: ts.JsxAttribute) => {
    const expression = attribute.initializer && ts.isJsxExpression(attribute.initializer) ? unwrap(attribute.initializer.expression) : undefined;
    if (!expression || !ts.isObjectLiteralExpression(expression)) {
      return add(attribute, "style-value", (line) => `Line ${line} sets style to something other than an object of Salt tokens; style values may only be Salt design tokens, var(--salt-*), or 0.`, "style");
    }
    for (const property of expression.properties) {
      if (!ts.isPropertyAssignment(property)) {
        const symbol = ts.isShorthandPropertyAssignment(property) ? `style.${property.name.text}` : "style";
        add(property, "style-value", (line) => `Line ${line} sets ${symbol} from ${shown(property.getText(file))}; style values may only be Salt design tokens, var(--salt-*), or 0.`, symbol);
        continue;
      }
      const name = propertyName(property.name, file);
      const problem = styleProblem(name, property.initializer, file);
      if (problem) add(property, problem.rule, (line) => `Line ${line} sets ${name} to ${problem.value}; ${STYLE_ADVICE[problem.rule]}`, `style.${name}`);
    }
  };

  const visit = (node: ts.Node): void => {
    if (ts.isTypeNode(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) return;

    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause;
      const typeOnly = !!clause && (clause.isTypeOnly || (!clause.name && !!clause.namedBindings && ts.isNamedImports(clause.namedBindings) && clause.namedBindings.elements.every((element) => element.isTypeOnly)));
      checkSpecifier(node.moduleSpecifier, moduleName(node.moduleSpecifier), typeOnly);
      if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const element of clause.namedBindings.elements) {
          const imported = (element.propertyName ?? element.name).text;
          if (PROVIDERS.has(imported)) add(element, "provider", () => providerMessage(imported), imported);
        }
      }
    } else if (ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier) checkSpecifier(node.moduleSpecifier, moduleName(node.moduleSpecifier), node.isTypeOnly);
      if (!node.isTypeOnly && node.exportClause && ts.isNamedExports(node.exportClause)) {
        for (const element of node.exportClause.elements) if (element.name.text === "default" && !element.isTypeOnly) defaults.push(element);
      }
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      checkSpecifier(node.moduleReference.expression, moduleName(node.moduleReference.expression), node.isTypeOnly);
    } else if (ts.isExportAssignment(node) && !node.isExportEquals) {
      defaults.push(node);
    } else if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword)) {
      defaults.push(node);
    } else if (ts.isJsxAttribute(node)) {
      checkAttribute(node);
    } else if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(file);
      const last = tag.split(".").pop()!;
      if (/^[a-z]/.test(tag) && FORBIDDEN_ELEMENTS.has(tag)) add(node, "style-element", (line) => `Line ${line} renders <${tag}>; prototypes may not add stylesheets, scripts, or embedded documents.`, tag);
      if (PROVIDERS.has(last)) add(node, "provider", () => providerMessage(last), last);
    } else if (ts.isPropertyAssignment(node) && propertyName(node.name, file) === "dangerouslySetInnerHTML") {
      add(node, "inner-html", (line) => `Line ${line} uses dangerouslySetInnerHTML; render content with Salt components instead.`, "dangerouslySetInnerHTML");
    } else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isPropertyAccessExpression(node.left) && ["innerHTML", "outerHTML"].includes(node.left.name.text)) {
      add(node, "inner-html", (line) => `Line ${line} sets ${node.left.getText(file)}; render content with Salt components instead.`, (node.left as ts.PropertyAccessExpression).name.text);
    } else if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      checkCall(node);
    } else if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      checkApi(node, memberPath(node));
    } else if (ts.isIdentifier(node) && isReference(node) && !local.has(node.text)) {
      const rule = GLOBALS.get(node.text);
      if (rule) add(node, rule, () => API_MESSAGES[rule](node.text), node.text);
    }
    ts.forEachChild(node, visit);
  };

  const checkCall = (node: ts.CallExpression | ts.NewExpression) => {
    if (node.expression.kind === ts.SyntaxKind.ImportKeyword) return add(node, "eval", () => API_MESSAGES.eval("import()"), "import()");
    const path = memberPath(node.expression);
    if (!path || local.has(path[0]!)) return;
    const rest = dropGlobalObjects(path);
    const callee = rest.join(".");
    const first = node.arguments?.[0];
    if (callee === "Function" || (callee === "require" && path.length === 1)) return add(node, "eval", () => API_MESSAGES.eval(callee), callee);
    if ((callee === "setTimeout" || callee === "setInterval") && first && (ts.isStringLiteralLike(first) || ts.isTemplateExpression(first))) {
      return add(node, "eval", () => `${API_MESSAGES.eval(`${callee} with a string`)} Pass a function instead.`, callee);
    }
    if (callee === "open" && path.length === 1) add(node, "window-open", () => API_MESSAGES["window-open"]("open()"), "open");
    if (path[path.length - 1] === "createElement" && first && ts.isStringLiteralLike(first) && FORBIDDEN_ELEMENTS.has(first.text.toLowerCase())) {
      add(node, "style-element", (line) => `Line ${line} creates a <${first.text}> element; prototypes may not add stylesheets, scripts, or embedded documents.`, first.text.toLowerCase());
    }
  };

  visit(file);

  if (isComponent && defaults.length === 0) {
    issues.push({ code: "salt-only/default-export", message: `${PROTOTYPE_FILE} must have exactly one default export, the prototype component; it has none.` });
  }
  if (isComponent && defaults.length > 1) {
    for (const node of defaults.slice(1)) add(node, "default-export", () => `${PROTOTYPE_FILE} must have exactly one default export, the prototype component; it has ${defaults.length}.`);
  }
}

const STYLE_ADVICE = {
  "literal-color": "use a Salt color token such as var(--salt-content-primary-foreground).",
  "literal-length": "use a Salt spacing or size token such as var(--salt-spacing-100).",
  "style-value": "style values may only be Salt design tokens, var(--salt-*), calc() of them, CSS keywords such as \"flex\", or 0; set typography with Salt's Text.",
} as const;

type StyleRule = keyof typeof STYLE_ADVICE;

/** Why a style property's value is not a Salt token, or null when it is one. */
function styleProblem(property: string, initializer: ts.Expression, file: ts.SourceFile): { rule: StyleRule; value: string } | null {
  const value = unwrap(initializer)!;
  const number = ts.isNumericLiteral(value) ? value : ts.isPrefixUnaryExpression(value) && ts.isNumericLiteral(value.operand) ? value.operand : null;
  if (number) {
    if (Number(number.text) === 0 || UNITLESS.has(property)) return null;
    return { rule: TYPOGRAPHY.has(property) ? "style-value" : "literal-length", value: value.getText(file) };
  }
  if (!ts.isStringLiteralLike(value)) return { rule: "style-value", value: shown(value.getText(file)) };
  const text = value.text.trim();
  if (text === "0" || SALT_VAR.test(text)) return null;
  const bare = withoutVars(text);
  if (HEX_COLOR.test(bare) || COLOR_FUNCTION.test(bare) || (bare.match(/[a-z]+/gi) ?? []).some((word) => NAMED_COLORS.has(word.toLowerCase()))) return { rule: "literal-color", value: shown(text) };
  if (LENGTH.test(bare)) return { rule: "literal-length", value: shown(text) };
  if (TYPOGRAPHY.has(property)) return { rule: "style-value", value: shown(JSON.stringify(text)) };
  if (KEYWORDS.test(text) || (text.includes("var(--salt-") && TOKEN_CALC.test(bare))) return null;
  return { rule: "style-value", value: shown(JSON.stringify(text)) };
}

/** The text without custom property names, so a token such as --salt-color-red-500 is not read as a literal, while a fallback still is. */
function withoutVars(text: string): string {
  return text.replace(/var\(\s*--[\w-]+\s*,?/g, " ");
}

function shown(text: string): string {
  const flat = text.replace(/\s+/g, " ");
  return flat.length > 60 ? `${flat.slice(0, 57)}...` : flat;
}

function providerMessage(name: string): string {
  return `${name} is provided by DE FabLab's preview frame; render the prototype without it.`;
}

function unwrap(expression: ts.Expression | undefined): ts.Expression | undefined {
  let current = expression;
  while (current && (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) || ts.isSatisfiesExpression(current) || ts.isNonNullExpression(current) || ts.isTypeAssertionExpression(current))) {
    current = current.expression;
  }
  return current;
}

function attributeName(attribute: ts.JsxAttribute): string {
  return ts.isIdentifier(attribute.name) ? attribute.name.text : `${attribute.name.namespace.text}:${attribute.name.name.text}`;
}

function propertyName(name: ts.PropertyName, file: ts.SourceFile): string {
  return ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name) || ts.isPrivateIdentifier(name) ? name.text : name.getText(file);
}

/** A JSX attribute's value when it is a plain string. */
function stringValue(initializer: ts.JsxAttributeValue | undefined): string | null {
  if (!initializer) return null;
  if (ts.isStringLiteral(initializer)) return initializer.text;
  const expression = ts.isJsxExpression(initializer) ? unwrap(initializer.expression) : undefined;
  return expression && ts.isStringLiteralLike(expression) ? expression.text : null;
}

/** `a.b["c"]` as ["a", "b", "c"], or null when any part is computed. */
function memberPath(node: ts.Expression): string[] | null {
  const expression = unwrap(node)!;
  if (ts.isIdentifier(expression)) return [expression.text];
  if (ts.isPropertyAccessExpression(expression)) {
    const base = memberPath(expression.expression);
    return base && [...base, expression.name.text];
  }
  if (ts.isElementAccessExpression(expression) && ts.isStringLiteralLike(expression.argumentExpression)) {
    const base = memberPath(expression.expression);
    return base && [...base, expression.argumentExpression.text];
  }
  return null;
}

function dropGlobalObjects(path: readonly string[]): readonly string[] {
  let start = 0;
  while (start < path.length && GLOBAL_OBJECTS.has(path[start]!)) start++;
  return path.slice(start);
}

/** Whether an identifier refers to a value, rather than naming a property, attribute, or label. */
function isReference(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (ts.isPropertyAccessExpression(parent)) return parent.expression === node;
  if (
    (ts.isPropertyAssignment(parent) || ts.isPropertyDeclaration(parent) || ts.isMethodDeclaration(parent) || ts.isPropertySignature(parent) || ts.isMethodSignature(parent) || ts.isGetAccessorDeclaration(parent) || ts.isSetAccessorDeclaration(parent) || ts.isEnumMember(parent)) &&
    parent.name === node
  ) {
    return false;
  }
  if (ts.isBindingElement(parent) && parent.propertyName === node) return false;
  if (ts.isJsxAttribute(parent) || ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent) || ts.isLabeledStatement(parent) || ts.isBreakOrContinueStatement(parent)) return false;
  if ((ts.isJsxOpeningElement(parent) || ts.isJsxSelfClosingElement(parent) || ts.isJsxClosingElement(parent)) && /^[a-z]/.test(node.text)) return false;
  return true;
}

/** Every name the file declares, so a local such as `const [open, setOpen]` is not read as a browser global. */
function declaredNames(file: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node)) {
      const parent = node.parent;
      const declares =
        (ts.isVariableDeclaration(parent) || ts.isBindingElement(parent) || ts.isParameter(parent) || ts.isFunctionDeclaration(parent) || ts.isFunctionExpression(parent) || ts.isClassDeclaration(parent) || ts.isClassExpression(parent) || ts.isImportClause(parent) || ts.isImportSpecifier(parent) || ts.isNamespaceImport(parent) || ts.isImportEqualsDeclaration(parent) || ts.isEnumDeclaration(parent)) &&
        parent.name === node;
      if (declares) names.add(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return names;
}
