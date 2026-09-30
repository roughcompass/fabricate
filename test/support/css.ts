import fs from "node:fs";
import path from "node:path";

/**
 * A small declaration scanner for the project's stylesheets: plain rules,
 * native nesting, and at-rules. It is not a general CSS parser; it is enough
 * to check which values each declaration uses and where it sits.
 */

export interface Declaration {
  property: string;
  value: string;
  important: boolean;
  line: number;
  /** Enclosing preludes, outermost first: at-rules ("@layer tokens") and selectors. */
  context: string[];
}

export function scanCss(source: string): Declaration[] {
  // Comments become spaces, keeping line numbers.
  const text = source.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "));
  const declarations: Declaration[] = [];
  const stack: string[] = [];
  let buffer = "";
  let bufferLine = 0;
  let line = 1;
  let quote: string | null = null;

  const flush = () => {
    const statement = buffer.trim();
    buffer = "";
    if (!statement || stack.length === 0) return;
    const colon = statement.indexOf(":");
    if (colon <= 0) return;
    const property = statement.slice(0, colon).trim().toLowerCase();
    let value = statement.slice(colon + 1).trim();
    const important = /!\s*important\s*$/i.test(value);
    if (important) value = value.replace(/!\s*important\s*$/i, "").trim();
    declarations.push({ property, value, important, line: bufferLine, context: [...stack] });
  };

  for (const char of text) {
    if (quote) {
      buffer += char;
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") {
      buffer += char;
      quote = char;
    } else if (char === "{") {
      stack.push(buffer.trim().replace(/\s+/g, " "));
      buffer = "";
    } else if (char === ";") {
      flush();
    } else if (char === "}") {
      flush();
      stack.pop();
    } else {
      if (!buffer.trim() && char.trim()) bufferLine = line;
      buffer += char;
    }
    if (char === "\n") line += 1;
  }
  return declarations;
}

/** Every stylesheet under src, relative to the project root. */
export function stylesheets(root: string): string[] {
  const files: string[] = [];
  const walk = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".css")) files.push(path.relative(root, full));
    }
  };
  walk(path.join(root, "src"));
  return files.sort();
}

/** The value of each token in both themes, resolved through var() and light-dark(). */
export function themeTokens(globals: string): { light: Map<string, string>; dark: Map<string, string> } {
  const raw = new Map<string, string>();
  for (const declaration of scanCss(globals)) {
    const [layer, selector] = declaration.context;
    const rootSelector = selector === ":root" || selector === ":root, [data-theme]";
    if (layer === "@layer tokens" && rootSelector && declaration.context.length === 2 && declaration.property.startsWith("--")) {
      raw.set(declaration.property, declaration.value);
    }
  }
  const resolve = (value: string, theme: 0 | 1, depth = 0): string => {
    if (depth > 10) throw new Error(`Token cycle in ${value}`);
    const lightDark = /^light-dark\((.*)\)$/s.exec(value.trim());
    if (lightDark) return resolve(splitTopLevel(lightDark[1]!)[theme]!, theme, depth + 1);
    const reference = /^var\((--[\w-]+)\)$/.exec(value.trim());
    if (reference) return resolve(raw.get(reference[1]!) ?? "", theme, depth + 1);
    return value.trim();
  };
  const light = new Map<string, string>();
  const dark = new Map<string, string>();
  for (const name of raw.keys()) {
    light.set(name, resolve(raw.get(name)!, 0));
    dark.set(name, resolve(raw.get(name)!, 1));
  }
  return { light, dark };
}

/** Splits a function's arguments on commas that are not inside parentheses. */
export function splitTopLevel(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of value) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else current += char;
  }
  parts.push(current.trim());
  return parts;
}

/** WCAG relative luminance of a #rrggbb color. */
export function luminance(hex: string): number {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) throw new Error(`Not a #rrggbb color: ${hex}`);
  const channel = (offset: number) => {
    const value = Number.parseInt(match[1]!.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

export function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}
