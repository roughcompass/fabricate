import crypto from "node:crypto";
import { RENDER_CONFIG_ID, type RenderConfig } from "@/prototypes/runtime/protocol";
import { type FramePreview, parseFramePreview } from "./preview-state";
import manifest from "./runtime-manifest.json";
import { GENERIC_USER } from "./seed/defaults";
import type { PersonaCopy, Scope, ShellConfig } from "./types";

/**
 * The document a version renders in (design.md, decision 8; prototypes/
 * preview spec, "Versions render in an isolated frame"). Every render route
 * builds it here: the frame route a workspace's pages embed, a share link's,
 * and a template's. The document runs only in a sandbox with an opaque
 * origin, so it sends no cookies on its own requests and can't read DE
 * FabLab's, and its policy lets it load nothing but the runtime.
 */

export const RUNTIME = manifest;

export interface RenderInput {
  readonly compiled: string;
  readonly scope: Scope;
  readonly title: string;
  readonly navItem: string | null;
  readonly personas: readonly PersonaCopy[];
  /** The shell to render a page in: the workspace's current one, or a share's or template's snapshot. */
  readonly shell: ShellConfig;
}

export type PreviewState = Pick<FramePreview, "mode" | "density">;

/** The mode and density in a frame's address, with the defaults Light and Medium (preview spec, "Preview controls"). */
export function previewState(params: URLSearchParams): PreviewState {
  const { mode, density } = parseFramePreview(params);
  return { mode, density };
}

/** The shell's navigation item a page belongs to, or null when the shell no longer has it (page-shell spec). */
export function currentNavItem(shell: ShellConfig, navItem: string | null): string | null {
  if (!navItem) return null;
  return shell.nav.some((item) => item.label === navItem || item.children.includes(navItem)) ? navItem : null;
}

/** The signed-in user a page's header shows: the version's first persona, or a fictional generic user. */
export function shellUser(personas: readonly PersonaCopy[]): { name: string; role: string } {
  const [first] = personas;
  return first ? { name: first.name, role: first.role } : GENERIC_USER;
}

/**
 * The origin the visitor's browser used. The frame posts its messages to it,
 * and messages to any other origin are dropped, so it comes from the request's
 * own host header rather than the URL the server rewrote.
 */
export function requestOrigin(request: Request): string {
  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? url.host;
  const protocol = request.headers.get("x-forwarded-proto") ?? url.protocol.replace(/:$/, "");
  return `${protocol.split(",")[0]!.trim()}://${host.split(",")[0]!.trim()}`;
}

const nonce = () => crypto.randomBytes(18).toString("base64");

/** Code inside a script element can't end it early. */
const scriptSafe = (code: string) => code.replace(/<\/(script)/gi, "<\\/$1").replace(/<!--/g, "<\\!--");
const jsonSafe = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c");
const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The frame's HTML and the headers that confine it. */
export function renderResponse(input: RenderInput, state: PreviewState, origin: string): Response {
  const scriptNonce = nonce();
  const styleNonce = nonce();
  const runtime = `${origin}${RUNTIME.base}`;
  const config: RenderConfig & { styleNonce: string } = {
    scope: input.scope,
    mode: state.mode,
    density: state.density,
    shell: input.scope === "page" ? { config: input.shell, current: currentNavItem(input.shell, input.navItem), user: shellUser(input.personas) } : null,
    user: shellUser(input.personas),
    title: input.title,
    parentOrigin: origin,
    styleNonce,
  };
  const html = [
    "<!doctype html>",
    `<html lang="en">`,
    "<head>",
    `<meta charset="utf-8">`,
    `<meta name="viewport" content="width=device-width, initial-scale=1">`,
    `<title>${escapeHtml(input.title || "Prototype")}</title>`,
    ...RUNTIME.styles.map((href) => `<link rel="stylesheet" href="${origin}${href}" crossorigin="anonymous">`),
    `<script type="importmap" nonce="${scriptNonce}">${jsonSafe({ imports: Object.fromEntries(Object.entries(RUNTIME.importMap.imports).map(([key, url]) => [key, `${origin}${url}`])) })}</script>`,
    `<script type="application/json" id="${RENDER_CONFIG_ID}">${jsonSafe(config)}</script>`,
    "</head>",
    "<body>",
    `<div id="prototype-root"></div>`,
    // The version registers its component first; module scripts run in document order.
    `<script type="module" nonce="${scriptNonce}">${scriptSafe(input.compiled)}</script>`,
    `<script type="module" src="${origin}${RUNTIME.host}" crossorigin="anonymous"></script>`,
    "</body>",
    "</html>",
  ].join("\n");
  const policy = [
    "default-src 'none'",
    `script-src 'nonce-${scriptNonce}' ${runtime}`,
    `style-src 'nonce-${styleNonce}' ${runtime}`,
    // Salt and React set style attributes for layout; they can't load anything.
    "style-src-attr 'unsafe-inline'",
    `font-src ${runtime}`,
    `img-src data: blob: ${runtime}`,
    // The capture embeds the runtime's fonts, which it reads from the runtime.
    `connect-src ${runtime}`,
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'self'",
    // The document is sandboxed even when it is opened in its own tab.
    "sandbox allow-scripts",
  ].join("; ");
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": policy,
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
