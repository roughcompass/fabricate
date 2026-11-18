import ts from "typescript";
import type { GateIssue, GateResult } from "../types";
import { ALLOWED_IMPORTS, DATA_FILE, DATA_MODULE, PORTAL_MODULE, PROTOTYPE_FILE, type PrototypeSource, STYLES_FILE, STYLES_MODULE, inFile, moduleName, parse, position, result } from "./common";
import { checkCssModule } from "./css-module";
import { paintProblem } from "./style-values";

/**
 * The Salt-only gate (design.md, decision 7; quality-checks spec, "Generated
 * code uses Salt exclusively"): a walk of the syntax tree of both files. It
 * never resolves types; the typecheck gate does that.
 */

export type SaltOnlyRule =
  | "import"
  | "inline-style"
  | "raw-element"
  | "literal-color"
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

/**
 * Lowercase elements generated code may render (quality-checks spec,
 * "Generated markup uses Salt components"): a form around Salt form fields,
 * and SVG drawing elements for a chart Salt doesn't provide. A portal shell
 * may also render its logo as an image. Everything else is a Salt component.
 */
const SANCTIONED_ELEMENTS = new Set(["form", "svg", "g", "path", "line", "polyline", "polygon", "rect", "circle", "ellipse", "text", "tspan", "title", "desc", "defs", "linearGradient", "stop", "clipPath"]);
const SHELL_ELEMENTS = new Set(["img"]);
/** The elements a Salt layout may render through `as`: landmarks, lists, and articles. */
const LAYOUT_ELEMENTS = new Set(["nav", "header", "main", "footer", "section", "aside", "ul", "ol", "li", "article"]);
/** SVG attributes that set a color, whose values must be Salt tokens or color-free keywords. */
const PAINT_ATTRIBUTES = new Set(["fill", "stroke", "stopColor", "stop-color", "color", "floodColor", "lightingColor"]);

export function saltOnlyGate(source: PrototypeSource): GateResult {
  const started = performance.now();
  const issues: GateIssue[] = [];
  const warnings: GateIssue[] = [];
  const styles = source.styles?.trim() ? checkCssModule(source.styles) : null;
  if (styles) {
    issues.push(...styles.issues);
    warnings.push(...styles.warnings);
  }
  const read = checkFile(parse(PROTOTYPE_FILE, source.code), true, issues, { portal: source.portal === true, shell: source.shell === true, styles: styles !== null });
  checkFile(parse(DATA_FILE, source.data), false, issues, { portal: false, shell: false, styles: false });
  if (styles && styles.issues.length === 0) {
    for (const name of styles.classes) if (!read.has(name)) warnings.push({ code: "salt-only/unused-class", message: `${STYLES_FILE} defines .${name}, which ${PROTOTYPE_FILE} never uses; remove it.`, symbol: name });
  }
  return result("salt-only", started, issues, warnings);
}

interface FileOptions {
  readonly portal: boolean;
  readonly shell: boolean;
  /** Whether the version has a CSS module the component may import. */
  readonly styles: boolean;
}

/** Checks one file, and returns the classes the component reads from its CSS module. */
function checkFile(file: ts.SourceFile, isComponent: boolean, issues: GateIssue[], options: FileOptions): Set<string> {
  const { portal, shell } = options;
  const local = declaredNames(file);
  const read = new Set<string>();
  /** The local names the CSS module is imported as. */
  const stylesNames = new Set<string>();
  const defaults: ts.Node[] = [];
  const add = (node: ts.Node, rule: SaltOnlyRule, message: (line: number) => string, symbol?: string) => {
    const at = position(file, node.getStart(file));
    issues.push({ code: `salt-only/${rule}`, message: inFile(file, message(at.line)), ...at, ...(symbol && { symbol }) });
  };

  const checkSpecifier = (node: ts.Node, specifier: string | null, typeOnly: boolean) => {
    if (specifier === null) return;
    if (specifier === STYLES_MODULE) {
      if (!isComponent || !options.styles) add(node, "import", () => (isComponent ? `"${STYLES_MODULE}" is imported, but this version has no CSS module.` : `The sample data module may not import "${STYLES_MODULE}".`), specifier);
      return;
    }
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

  /** Whether a className expression reads only the CSS module's classes and AG Grid's Salt theme classes. */
  const allowedClass = (expression: ts.Expression | undefined): boolean => {
    const value = unwrap(expression);
    if (!value) return false;
    if (ts.isStringLiteralLike(value)) return value.text.trim() === "" || value.text.trim().split(/\s+/).every((entry) => AG_THEME_CLASS.test(entry));
    if (value.kind === ts.SyntaxKind.UndefinedKeyword || value.kind === ts.SyntaxKind.NullKeyword || (ts.isIdentifier(value) && value.text === "undefined")) return true;
    if ((ts.isPropertyAccessExpression(value) || ts.isElementAccessExpression(value)) && ts.isIdentifier(value.expression) && stylesNames.has(value.expression.text)) {
      const key = ts.isPropertyAccessExpression(value) ? value.name.text : ts.isStringLiteralLike(value.argumentExpression) ? value.argumentExpression.text : null;
      if (key === null) return false;
      read.add(key);
      return true;
    }
    if (ts.isConditionalExpression(value)) return allowedClass(value.whenTrue) && allowedClass(value.whenFalse);
    if (ts.isTemplateExpression(value)) return value.templateSpans.every((span) => allowedClass(span.expression)) && [value.head.text, ...value.templateSpans.map((span) => span.literal.text)].every((part) => part.trim() === "");
    // [styles.a, selected && styles.b].filter(Boolean).join(" ")
    if (ts.isCallExpression(value) && ts.isPropertyAccessExpression(value.expression) && value.expression.name.text === "join") {
      const filtered = unwrap(value.expression.expression);
      const list = filtered && ts.isCallExpression(filtered) && ts.isPropertyAccessExpression(filtered.expression) && filtered.expression.name.text === "filter" ? unwrap(filtered.expression.expression) : filtered;
      return !!list && ts.isArrayLiteralExpression(list) && list.elements.every((element) => (ts.isBinaryExpression(element) && element.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ? allowedClass(element.right) : allowedClass(element)));
    }
    return false;
  };

  const checkAttribute = (attribute: ts.JsxAttribute) => {
    const name = attributeName(attribute);
    if (name === "style") return add(attribute, "inline-style", (line) => `Line ${line} sets style; use a Salt component's properties or a layout's gap and padding, and put anything else in ${STYLES_FILE}.`, "style");
    if (name === "className" || name === "class") {
      const expression = attribute.initializer && ts.isJsxExpression(attribute.initializer) ? attribute.initializer.expression : attribute.initializer && ts.isStringLiteral(attribute.initializer) ? attribute.initializer : undefined;
      if (!allowedClass(expression)) {
        add(attribute, "class-name", (line) => `Line ${line} sets ${name} to something other than a class of ${STYLES_FILE} or AG Grid's Salt theme; use styles.<class> from the CSS module.`, "className");
      }
      return;
    }
    if (name === "as") {
      const value = stringValue(attribute.initializer);
      if (value !== null && /^[a-z]/.test(value) && !LAYOUT_ELEMENTS.has(value)) add(attribute, "raw-element", (line) => `Line ${line} renders a Salt layout as <${value}>; a layout may render only landmarks, lists, and articles (${[...LAYOUT_ELEMENTS].join(", ")}).`, value);
      return;
    }
    const element = attribute.parent.parent;
    if (PAINT_ATTRIBUTES.has(name) && /^[a-z]/.test(element.tagName.getText(file))) {
      const value = stringValue(attribute.initializer);
      if (value !== null && paintProblem(value)) add(attribute, "literal-color", (line) => `Line ${line} sets ${name} to ${value}; use a Salt color token such as var(--salt-content-primary-foreground), or currentColor.`, name);
      return;
    }
    if (name === "dangerouslySetInnerHTML") return add(attribute, "inner-html", (line) => `Line ${line} uses dangerouslySetInnerHTML; render content with Salt components instead.`, name);
    if (ASSET_ATTRIBUTES.has(name)) {
      const value = stringValue(attribute.initializer)?.trim();
      if (value && EXTERNAL_URL.test(value)) add(attribute, "external-asset", (line) => `Line ${line} loads ${value} from outside DE FabLab; prototypes may not load external assets.`, name);
    }
  };

  const visit = (node: ts.Node): void => {
    if (ts.isTypeNode(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) return;

    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause;
      const typeOnly = !!clause && (clause.isTypeOnly || (!clause.name && !!clause.namedBindings && ts.isNamedImports(clause.namedBindings) && clause.namedBindings.elements.every((element) => element.isTypeOnly)));
      const specifier = moduleName(node.moduleSpecifier);
      checkSpecifier(node.moduleSpecifier, specifier, typeOnly);
      if (specifier === STYLES_MODULE && isComponent && options.styles) {
        if (clause?.name) stylesNames.add(clause.name.text);
        if (!clause?.name || clause.namedBindings) add(node, "import", () => `Import the CSS module only as a default import: import styles from "${STYLES_MODULE}".`, STYLES_MODULE);
      }
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
      else if (/^[a-z]/.test(tag) && !SANCTIONED_ELEMENTS.has(tag) && !(shell && SHELL_ELEMENTS.has(tag))) {
        add(node, "raw-element", (line) => `Line ${line} renders <${tag}>; use a Salt component, or a Salt layout such as StackLayout or FlexLayout (with as="${LAYOUT_ELEMENTS.has(tag) ? tag : "section"}" for a landmark or list).`, tag);
      }
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
  return read;
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
