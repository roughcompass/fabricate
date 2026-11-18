/**
 * What a style value may be in prototype and template code (quality-checks
 * spec, "A CSS module holds only token-based class rules"): Salt design
 * tokens, calc() and grid functions over them, CSS keywords, relative units,
 * unitless counts where the property takes them, and 0. Never a literal
 * color, a fixed length, or a literal font.
 */

export type StyleValueRule = "literal-color" | "literal-length" | "style-value";

/** Unitless CSS properties, where a number is a count or a ratio rather than a size. */
const UNITLESS = new Set(["flex", "flexGrow", "flexShrink", "opacity", "zIndex", "order", "gridRow", "gridColumn", "gridRowStart", "gridRowEnd", "gridColumnStart", "gridColumnEnd", "columnCount", "aspectRatio", "lineClamp", "WebkitLineClamp"]);

/** Typography comes from Salt's Text and its tokens, never from literal values. */
const TYPOGRAPHY = new Set(["font", "fontFamily", "fontSize", "fontWeight", "fontStyle", "lineHeight", "letterSpacing"]);

/** Color keywords that carry no color of their own. */
const NEUTRAL_COLORS = new Set(["transparent", "currentcolor", "inherit"]);

const NAMED_COLORS = new Set(
  (
    "black white red green blue yellow orange purple pink brown gray grey navy teal silver gold maroon olive lime aqua cyan magenta fuchsia indigo violet " +
    "coral salmon crimson tomato turquoise beige ivory khaki lavender tan plum orchid chocolate firebrick darkred darkblue darkgreen darkgray darkgrey " +
    "darkorange lightgray lightgrey lightblue lightgreen lightyellow whitesmoke gainsboro slategray slategrey steelblue royalblue skyblue dodgerblue " +
    "midnightblue forestgreen seagreen goldenrod rebeccapurple"
  ).split(" "),
);
const HEX_COLOR = /#[0-9a-f]{3,8}\b/i;
const COLOR_FUNCTION = /^(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix)$/i;
const SALT_VAR = /^var\(\s*--salt-[a-z0-9-]+\s*(,\s*var\(\s*--salt-[a-z0-9-]+\s*\)\s*)?\)$/i;
const KEYWORD = /^-?[a-z]+(-[a-z]+)*$/i;
const NUMBER = /^-?(\d+\.?\d*|\.\d+)$/;
/** Relative units that size by proportion, not by a fixed amount. */
const RELATIVE = /^-?(\d+\.?\d*|\.\d+)(%|fr)$/;
const LENGTH = /^-?(\d+\.?\d*|\.\d+)(px|rem|em|vh|vw|vmin|vmax|dvh|dvw|svh|svw|lvh|lvw|ch|ex|pt|pc|cm|mm|in|q|cqi|cqb|cqw|cqh)$/i;
/** Functions whose arguments are themselves style values. */
const VALUE_FUNCTIONS = new Set(["calc", "min", "max", "clamp", "minmax", "repeat", "fit-content"]);

export interface StyleValueProblem {
  readonly rule: StyleValueRule;
  readonly value: string;
}

export const STYLE_ADVICE: Readonly<Record<StyleValueRule, string>> = {
  "literal-color": "use a Salt color token such as var(--salt-content-primary-foreground).",
  "literal-length": "use a Salt spacing or size token such as var(--salt-spacing-100).",
  "style-value": "values may only be Salt design tokens, var(--salt-*), calc() of them, CSS keywords, relative units, or 0; set typography with Salt's Text or its tokens.",
};

/** A kebab-case CSS property as the camel case the rules are keyed by: font-size is fontSize. */
export function camelProperty(property: string): string {
  return property.trim().replace(/^-webkit-/, "Webkit-").replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

/** The value's parts at its top level, split on spaces, commas, and slashes outside parentheses. */
export function valueParts(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of value) {
    if (char === "(") depth++;
    if (char === ")") depth--;
    if (depth === 0 && (char === " " || char === "," || char === "/" || char === "\n" || char === "\t")) {
      if (current.trim()) parts.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

/** Why a style value isn't made of Salt tokens and allowed keywords, or null when it is. */
export function styleValueProblem(property: string, value: string): StyleValueProblem | null {
  const text = value.trim();
  if (!text) return { rule: "style-value", value: '""' };
  for (const part of valueParts(text)) {
    const problem = partProblem(property, part);
    if (problem) return { rule: problem, value: text.length > 60 ? `${text.slice(0, 57)}...` : text };
  }
  return null;
}

function partProblem(property: string, part: string): StyleValueRule | null {
  if (part === "0" || SALT_VAR.test(part)) return null;
  if (HEX_COLOR.test(part)) return "literal-color";
  const call = /^([a-z-]+)\((.*)\)$/is.exec(part);
  if (call) {
    const name = call[1]!.toLowerCase();
    if (COLOR_FUNCTION.test(name)) return "literal-color";
    if (name === "var") return "style-value";
    if (!VALUE_FUNCTIONS.has(name)) return "style-value";
    // calc() may combine tokens with plain numbers: calc(var(--salt-size-base) * 2).
    if (name === "calc") return calcProblem(call[2]!);
    for (const argument of valueParts(call[2]!)) {
      if (NUMBER.test(argument)) continue;
      const problem = partProblem(property, argument);
      if (problem) return problem;
    }
    return null;
  }
  if (NUMBER.test(part)) return UNITLESS.has(property) ? null : TYPOGRAPHY.has(property) ? "style-value" : "literal-length";
  if (RELATIVE.test(part)) return TYPOGRAPHY.has(property) ? "style-value" : null;
  if (LENGTH.test(part)) return TYPOGRAPHY.has(property) ? "style-value" : "literal-length";
  if (KEYWORD.test(part)) {
    const lower = part.toLowerCase();
    if (NAMED_COLORS.has(lower)) return "literal-color";
    if (TYPOGRAPHY.has(property) && !["inherit", "normal", "italic"].includes(lower)) return "style-value";
    return null;
  }
  if (NEUTRAL_COLORS.has(part.toLowerCase())) return null;
  return "style-value";
}

/** A calc() is fine when it reads a Salt token and otherwise holds only numbers, operators, and parentheses. */
function calcProblem(body: string): StyleValueRule | null {
  if (!body.includes("var(--salt-")) return "style-value";
  const bare = body.replace(/var\(\s*--salt-[a-z0-9-]+\s*\)/gi, " ");
  if (/var\(/i.test(bare)) return "style-value";
  if (/\d(px|rem|em|vh|vw|ch|pt)\b/i.test(bare)) return "literal-length";
  return /^[\s\d.+\-*/()%]*$/.test(bare) ? null : "style-value";
}

/** Whether an SVG paint attribute's value is a Salt token or a color-free keyword. */
export function paintProblem(value: string): boolean {
  const text = value.trim();
  return !(SALT_VAR.test(text) || ["none", "currentcolor", "transparent", "inherit"].includes(text.toLowerCase()));
}
