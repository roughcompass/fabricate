import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { type Declaration, scanCss, stylesheets } from "../support/css";

/**
 * Stylesheets use only design tokens of the matching type (design.md,
 * decision 2): no literal colors, no lengths off the scales, no undefined or
 * mistyped token references, and no !important outside the reset,
 * visually hidden, and reduced-motion rules.
 *
 * The template demo's portal runtime has its own token set (template demo
 * design.md, decision 15): runtime tokens are named --rt-<type>-… and defined
 * in RUNTIME_TOKENS under @layer runtime-tokens. Only stylesheets under
 * src/demo/runtime/ may use them, and those sit in @layer runtime and select
 * only by class, so portal styles can never reach the toolbar or the page.
 */

const ROOT = path.resolve(".");
const GLOBALS = "src/app/globals.css";
const RUNTIME_DIR = "src/demo/runtime/";
const RUNTIME_TOKENS = "src/demo/runtime/tokens.css";

/** Every stylesheet is migrated; this list must stay empty. */
const NOT_YET_MIGRATED = new Set<string>([]);

/** Custom properties defined outside the stylesheets, by the font loader. */
const EXTERNAL_TOKENS = new Set(["--font-geist-sans", "--font-geist-mono"]);

type Rule = { prefixes: string[]; keywords?: RegExp };

const COLOR: Rule = { prefixes: ["--color-"], keywords: /^(transparent|currentcolor|inherit|none)$/i };
const SPACE: Rule = { prefixes: ["--space-", "--size-"] };
const SIZE: Rule = { prefixes: ["--size-", "--space-"] };

const RULES: [RegExp, Rule][] = [
  [/^(color|background-color|border(-(top|right|bottom|left|block|inline)(-(start|end))?)?-color|outline-color|fill|stroke|accent-color|caret-color|text-decoration-color|column-rule-color)$/, COLOR],
  [/^background$/, COLOR],
  [/^(border(-(top|right|bottom|left|block|inline)(-(start|end))?)?|outline|text-decoration)$/, COLOR],
  [/^font-size$/, { prefixes: ["--font-size-"] }],
  [/^font-weight$/, { prefixes: ["--font-weight-"] }],
  [/^line-height$/, { prefixes: ["--line-height-"], keywords: /^(1|normal|inherit)$/ }],
  [/^letter-spacing$/, { prefixes: ["--letter-spacing-"] }],
  [/^font-family$/, { prefixes: ["--font-family-"] }],
  [/^(margin|padding|scroll-margin|scroll-padding)(-.+)?$|^(gap|row-gap|column-gap|inset(-.+)?|top|right|bottom|left|text-indent)$/, SPACE],
  [/^((min|max)-)?(width|height|inline-size|block-size)$|^flex-basis$/, SIZE],
  [/^grid-template-(columns|rows)$|^grid-auto-(columns|rows)$/, SIZE],
  [/^border(-(top|bottom)-(left|right)|-(start|end)-(start|end))?-radius$/, { prefixes: ["--radius-"] }],
  [/^box-shadow$/, { prefixes: ["--shadow-"], keywords: /^none$/ }],
  [/^z-index$/, { prefixes: ["--z-"], keywords: /^(0|auto)$/ }],
  [/^(transition|animation)(-duration|-delay|-timing-function)?$/, { prefixes: ["--duration-", "--ease-"] }],
];

// CSS named colors other than the keywords that are allowed everywhere.
const NAMED_COLORS = new Set(
  "aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen".split(" "),
);

const LENGTH = /(?<![\w-])(-?\d*\.?\d+)(px|rem|em|pt|pc|cm|mm|in|ex|ch|q)\b/gi;
const ALLOWED_LENGTH = /^-?(0|1|2)px$/i;
const TIME = /(?<![\w-])\d*\.?\d+m?s\b/i;
const LITERAL_COLOR = /#[0-9a-f]{3,8}\b|\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|light-dark)\(/i;

/** The custom properties a stylesheet defines. */
function definedIn(source: string): Set<string> {
  return new Set(scanCss(source).filter((declaration) => declaration.property.startsWith("--")).map((declaration) => declaration.property));
}

const GLOBAL_TOKENS = definedIn(fs.readFileSync(path.join(ROOT, GLOBALS), "utf8"));
const RUNTIME_TOKEN_SET = fs.existsSync(path.join(ROOT, RUNTIME_TOKENS)) ? definedIn(fs.readFileSync(path.join(ROOT, RUNTIME_TOKENS), "utf8")) : new Set<string>();

const isRuntime = (file: string) => file.startsWith(RUNTIME_DIR);

function isTokenDefinition(file: string, declaration: Declaration): boolean {
  if (!declaration.property.startsWith("--")) return false;
  if (file === GLOBALS) return declaration.context[0] === "@layer tokens";
  return file === RUNTIME_TOKENS && declaration.context[0] === "@layer runtime-tokens";
}

/** A runtime token's type is the type of the interface token it mirrors: --rt-color-… is a color. */
function typeName(name: string): string {
  return name.startsWith("--rt-") ? `--${name.slice("--rt-".length)}` : name;
}

/**
 * Runtime stylesheets select only by class (or nest under one): no element,
 * universal, :root, or :global selectors.
 */
function selectorProblem(prelude: string): string | null {
  if (prelude.startsWith("@") || /^(from|to|\d+%)(\s*,\s*(from|to|\d+%))*$/.test(prelude)) return null;
  if (/:root\b|:global\b/.test(prelude)) return `selects with "${prelude}"`;
  for (const selector of prelude.split(",")) {
    for (const compound of selector.trim().split(/\s*[>+~]\s*|\s+/).filter(Boolean)) {
      if (/^(\*|[a-z])/i.test(compound)) return `selects an element with "${compound}"`;
    }
  }
  return null;
}

/**
 * Page layouts respond to the content column's width through `@container
 * content` (vercel-application-shell design.md, decision 7). Viewport width
 * queries remain only where the viewport is the reference: the shell itself,
 * the fixed toast viewports, the gutter step, and the demo's toolbar and
 * portal runtime, which render outside the shell.
 */
const VIEWPORT_QUERY_FILES = new Set([
  GLOBALS,
  "src/components/shell/app-shell.module.css",
  "src/components/shell/shell-header.module.css",
  "src/components/shell/sidebar-resizer.module.css",
  "src/components/ui/toast.module.css",
  "src/components/ui/flash-toast.module.css",
]);
const viewportQueryAllowed = (file: string) => VIEWPORT_QUERY_FILES.has(file) || file.startsWith("src/components/toolbar/") || file.startsWith("src/demo/");
const WIDTH_QUERY = /^@media\b.*\b(min|max)-width\b/;

function importantAllowed(file: string, declaration: Declaration): boolean {
  if (declaration.context.some((prelude) => /visually-?hidden/i.test(prelude))) return true;
  return file === GLOBALS && declaration.context.some((prelude) => prelude === "@layer reset" || prelude.includes("prefers-reduced-motion"));
}

/** Every violation in one stylesheet, as "file:line property: reason". */
export function violations(file: string, source: string, runtimeTokens: ReadonlySet<string> = RUNTIME_TOKEN_SET): string[] {
  const local = definedIn(source);
  const problems: string[] = [];
  const report = (declaration: Declaration, reason: string) => problems.push(`${file}:${declaration.line} ${declaration.property}: ${reason}`);
  // The demo toolbar's tools (src/demo/toolbar/) are operator interface, like shared components.
  const expectedLayer = file.startsWith("src/components/") || file.startsWith("src/demo/toolbar/")
    ? "@layer components"
    : file === RUNTIME_TOKENS
      ? "@layer runtime-tokens"
      : isRuntime(file)
        ? "@layer runtime"
        : file.startsWith("src/app/") && file !== GLOBALS
          ? "@layer pages"
          : null;
  const known = (name: string) => GLOBAL_TOKENS.has(name) || local.has(name) || EXTERNAL_TOKENS.has(name) || (isRuntime(file) && runtimeTokens.has(name));
  const reportedSelectors = new Set<string>();
  const reportedQueries = new Set<string>();

  for (const declaration of scanCss(source)) {
    const { property, value } = declaration;
    const references = [...value.matchAll(/var\(\s*(--[\w-]+)/g)].map((match) => match[1]!);

    for (const name of references) {
      if (!known(name)) report(declaration, `references undefined token ${name}`);
    }
    if (!viewportQueryAllowed(file)) {
      for (const prelude of declaration.context) {
        if (WIDTH_QUERY.test(prelude) && !reportedQueries.has(prelude)) {
          reportedQueries.add(prelude);
          report(declaration, `is in a viewport width query "${prelude}"; use @container content`);
        }
      }
    }
    if (isRuntime(file) && file !== RUNTIME_TOKENS) {
      for (const prelude of declaration.context) {
        const problem = selectorProblem(prelude);
        if (problem && !reportedSelectors.has(prelude)) {
          reportedSelectors.add(prelude);
          report(declaration, problem);
        }
      }
    }
    if (declaration.important && !importantAllowed(file, declaration)) report(declaration, "uses !important");
    if (expectedLayer && !declaration.context.includes(expectedLayer)) report(declaration, `is outside ${expectedLayer}`);
    if (isTokenDefinition(file, declaration)) continue;

    if (LITERAL_COLOR.test(value)) report(declaration, `uses a literal color in "${value}"`);
    const words = value.toLowerCase().split(/[^a-z]+/);
    const named = words.find((word) => NAMED_COLORS.has(word));
    if (named && !/^--/.test(property) && !/^(content|grid-area|grid-template-areas|font-family|transition(-property)?|animation(-name)?)$/.test(property)) {
      report(declaration, `uses the named color "${named}"`);
    }
    for (const [length] of value.matchAll(LENGTH)) {
      if (!ALLOWED_LENGTH.test(length)) report(declaration, `uses the literal length ${length}`);
    }

    const rule = RULES.find(([pattern]) => pattern.test(property))?.[1];
    if (!rule) continue;
    for (const name of references) {
      const typed = rule.prefixes.some((prefix) => typeName(name).startsWith(prefix));
      if (!typed && !(local.has(name) && name.startsWith("--_"))) report(declaration, `uses ${name}, which is not a ${rule.prefixes.join(" or ")} token`);
    }
    if (property.startsWith("transition") || property.startsWith("animation")) {
      const reducedMotion = declaration.context.some((prelude) => prelude.includes("prefers-reduced-motion"));
      if (!reducedMotion && TIME.test(value.replace(/var\([^)]*\)/g, ""))) report(declaration, "uses a literal duration");
      continue;
    }
    // Typed properties that take one value must name a token or an allowed keyword.
    if (/^(font-size|font-weight|line-height|letter-spacing|font-family|box-shadow|z-index)$/.test(property)) {
      const bare = value.trim();
      if (!references.length && !(rule.keywords?.test(bare) || /^inherit$/i.test(bare))) report(declaration, `must use a ${rule.prefixes.join(" or ")} token`);
    }
  }
  return problems;
}

describe("design token check", () => {
  const check = (css: string, file = "src/components/ui/example.module.css") => violations(file, css);

  it("rejects a literal color", () => {
    expect(check("@layer components { .a { color: #31373d; } }")).toContainEqual(expect.stringContaining("literal color"));
    expect(check("@layer components { .a { border: 1px solid white; } }")).toContainEqual(expect.stringContaining('named color "white"'));
  });

  it("rejects a token of the wrong type", () => {
    expect(check("@layer components { .a { color: var(--font-size-heading); } }")).toContainEqual(expect.stringContaining("not a --color- token"));
  });

  it("rejects an undefined token", () => {
    expect(check("@layer components { .a { color: var(--color-imaginary); } }")).toContainEqual(expect.stringContaining("undefined token --color-imaginary"));
  });

  it("rejects a viewport width query in a component or route stylesheet", () => {
    const narrow = "@layer components { @media (max-width: 767px) { .a { gap: var(--space-2); } } }";
    expect(check(narrow)).toContainEqual(expect.stringContaining("use @container content"));
    expect(check(narrow.replace("components", "pages"), "src/app/(operator)/example/example.module.css")).toContainEqual(expect.stringContaining("use @container content"));
  });

  it("accepts a container query anywhere, and viewport queries where the viewport is the reference", () => {
    expect(check("@layer components { @container content (max-width: 767px) { .a { gap: var(--space-2); } } }")).toEqual([]);
    expect(check("@layer components { @media (max-width: 1023px) { .a { gap: var(--space-2); } } }", "src/components/shell/app-shell.module.css")).toEqual([]);
    expect(check("@layer components { @media (pointer: coarse) { .a { gap: var(--space-2); } } }")).toEqual([]);
  });

  it("rejects !important outside the allowed rules", () => {
    expect(check("@layer components { .a { color: var(--color-text) !important; } }")).toContainEqual(expect.stringContaining("!important"));
    expect(check("@layer components { .visually-hidden { position: absolute !important; } }")).toEqual([]);
  });

  it("rejects lengths off the scales and literal durations", () => {
    expect(check("@layer components { .a { padding: 10px; } }")).toContainEqual(expect.stringContaining("literal length 10px"));
    expect(check("@layer components { .a { font-size: 0.875rem; } }")).toContainEqual(expect.stringContaining("literal length 0.875rem"));
    expect(check("@layer components { .a { transition: color 150ms ease; } }")).toContainEqual(expect.stringContaining("literal duration"));
  });

  it("rejects rules outside the stylesheet's cascade layer", () => {
    expect(check(".a { color: var(--color-text); }")).toContainEqual(expect.stringContaining("outside @layer components"));
    expect(check(".a { color: var(--color-text); }", "src/app/example/page.module.css")).toContainEqual(expect.stringContaining("outside @layer pages"));
  });

  describe("portal runtime stylesheets", () => {
    const SAMPLE_TOKENS = new Set(["--rt-color-brand", "--rt-size-rail"]);
    const runtime = (css: string) => violations("src/demo/runtime/shells/payments/shell.module.css", css, SAMPLE_TOKENS);
    const tokens = `@layer runtime-tokens { .runtime { --rt-color-brand: light-dark(#26337a, #9fb0ff); --rt-size-rail: 240px; } }`;

    it("accepts runtime token definitions with literal values in the token file", () => {
      expect(check(tokens, RUNTIME_TOKENS)).toEqual([]);
    });

    it("rejects a literal color in a runtime stylesheet", () => {
      expect(runtime("@layer runtime { .shell { color: #26337a; } }")).toContainEqual(expect.stringContaining("literal color"));
    });

    it("rejects a runtime token in an interface stylesheet", () => {
      expect(violations("src/components/ui/example.module.css", "@layer components { .a { color: var(--rt-color-brand); } }", SAMPLE_TOKENS)).toContainEqual(
        expect.stringContaining("undefined token --rt-color-brand"),
      );
    });

    it("accepts runtime and interface tokens of the matching type in a runtime stylesheet", () => {
      expect(runtime("@layer runtime { .shell { color: var(--rt-color-brand); width: var(--rt-size-rail); padding: var(--space-2); & .title { font-size: var(--font-size-heading); } } }")).toEqual([]);
    });

    it("rejects a runtime token of the wrong type", () => {
      expect(runtime("@layer runtime { .shell { padding: var(--rt-color-brand); } }")).toContainEqual(expect.stringContaining("not a --space- or --size- token"));
    });

    it.each([
      [":global", "@layer runtime { :global(.toolbar) { color: var(--color-text); } }"],
      [":root", "@layer runtime { :root { color: var(--color-text); } }"],
      ["an element", "@layer runtime { body { color: var(--color-text); } }"],
      ["a descendant element", "@layer runtime { .shell button { color: var(--color-text); } }"],
      ["the universal selector", "@layer runtime { * { color: var(--color-text); } }"],
    ])("rejects %s selector in a runtime stylesheet", (_label, css) => {
      expect(runtime(css)).toContainEqual(expect.stringMatching(/selects/));
    });

    it("requires runtime stylesheets to sit in @layer runtime", () => {
      expect(runtime(".shell { color: var(--color-text); }")).toContainEqual(expect.stringContaining("outside @layer runtime"));
      expect(check(".runtime { --rt-color-brand: #26337a; }", RUNTIME_TOKENS)).toContainEqual(expect.stringContaining("outside @layer runtime-tokens"));
    });
  });

  it("accepts a compliant stylesheet", () => {
    const css = `@layer components {
      .a {
        --_indent: var(--space-4);
        display: flex;
        padding: var(--space-2) var(--_indent);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        color: var(--color-text);
        font-size: var(--font-size-body);
        transition: background var(--duration-fast) var(--ease-standard);
        &:hover { background: var(--color-bg-muted); }
      }
      @container content (max-width: 767px) { .a { padding: var(--space-1); } }
    }`;
    expect(check(css)).toEqual([]);
  });

  it("keeps every migrated stylesheet compliant", () => {
    const files = stylesheets(ROOT).filter((file) => !NOT_YET_MIGRATED.has(file));
    expect(files).toContain(GLOBALS);
    expect(files.flatMap((file) => violations(file, fs.readFileSync(path.join(ROOT, file), "utf8")))).toEqual([]);
  });

  it("leaves no stylesheet unmigrated", () => {
    expect([...NOT_YET_MIGRATED]).toEqual([]);
  });
});
