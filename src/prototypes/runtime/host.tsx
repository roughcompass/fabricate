import { SaltProviderNext, Text } from "@salt-ds/core";
import { AdapterDateFns } from "@salt-ds/date-adapters/date-fns";
import { LocalizationProvider } from "@salt-ds/date-components";
import { CSPProvider } from "@salt-ds/styles";
import { AllCommunityModule, ModuleRegistry } from "ag-grid-community";
import { Component, type ComponentType, type ErrorInfo, type ReactNode, StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import type { AuditViolation, Impact } from "@/lib/prototypes/types";
import { describeElement, findByLocator, nearestComponent } from "./inspector";
import { CSS_GLOBAL, type FrameMessage, PAGE_MESSAGE_TYPES, PROTOTYPE_GLOBAL, type PageMessage, RENDER_CONFIG_ID, type RenderConfig, envelope, readMessage } from "./protocol";
import { PageShell } from "./shell/page-shell";
import "./host.css";

/*
 * The render host (design.md, decision 8). It runs inside the sandboxed frame,
 * after the version's compiled module has registered its component, and wraps
 * every prototype in Salt's provider with the JPM Brand theme and in Salt's
 * date localization, so generated code never sets either up. It reports
 * render errors, runs the accessibility audit, and handles element notes,
 * pins, and captures, all through typed messages to the page that embeds it.
 */

ModuleRegistry.registerModules([AllCommunityModule]);

const config = JSON.parse(document.getElementById(RENDER_CONFIG_ID)?.textContent ?? "null") as (RenderConfig & { styleNonce: string }) | null;
const registered = (globalThis as Record<string, unknown>)[PROTOTYPE_GLOBAL] as ComponentType | undefined;

function post(message: FrameMessage): void {
  if (config && window.parent !== window) window.parent.postMessage(envelope(message), config.parentOrigin);
}

class RenderBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error, _info: ErrorInfo) {
    post({ type: "render-error", message: error.message || String(error) });
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="prototypeHost-error" role="alert">
        <Text styleAs="h4">This version failed to render</Text>
        <Text>{this.state.error.message || String(this.state.error)}</Text>
      </div>
    );
  }
}

function Ready({ children }: { children: ReactNode }) {
  useEffect(() => {
    // After the first render commits. A timer, not an animation frame: browsers pause those in frames that aren't visible, such as the audit frame.
    const timer = setTimeout(() => post({ type: "ready", height: document.documentElement.scrollHeight }), 50);
    return () => clearTimeout(timer);
  }, []);
  return children;
}

function Prototype({ component: Registered }: { component: ComponentType }) {
  if (!config) return null;
  const body = (
    <RenderBoundary>
      <Registered />
    </RenderBoundary>
  );
  return (
    <CSPProvider nonce={config.styleNonce}>
      <SaltProviderNext mode={config.mode} density={config.density} accent="teal" corner="rounded">
        <LocalizationProvider DateAdapter={AdapterDateFns}>
          <Ready>
            {config.shell ? (
              <PageShell config={config.shell.config} current={config.shell.current} user={config.shell.user}>
                {body}
              </PageShell>
            ) : (
              <div className="prototypeHost-surface" data-prototype-root="">
                {body}
              </div>
            )}
          </Ready>
        </LocalizationProvider>
      </SaltProviderNext>
    </CSPProvider>
  );
}

/** Where the prototype's own content is: the shell's main region, or the component surface. */
function contentRoot(): Element {
  return document.getElementById("page-shell-main") ?? document.querySelector("[data-prototype-root]") ?? document.body;
}

// --- The accessibility audit (quality-checks spec, "An accessibility audit runs on the rendered version")

const IMPACTS: readonly Impact[] = ["minor", "moderate", "serious", "critical"];

async function runAudit(): Promise<void> {
  try {
    const { default: axe } = await import("axe-core");
    const results = await axe.run(document, { resultTypes: ["violations"] });
    const violations: AuditViolation[] = results.violations.map((violation) => ({
      rule: violation.id,
      impact: IMPACTS.includes(violation.impact as Impact) ? (violation.impact as Impact) : "moderate",
      description: violation.description,
      help: violation.help,
      targets: violation.nodes.map((node) => node.target.map(String).join(" ")),
      html: violation.nodes.map((node) => node.html.slice(0, 300)),
    }));
    post({ type: "audit-result", violations });
  } catch (error) {
    post({ type: "audit-error", message: (error as Error).message });
  }
}

// --- Overlays: the comment-mode highlight, the pins, and violation highlights, outside the prototype's React tree.

function overlay(className: string): HTMLDivElement {
  const element = document.createElement("div");
  element.className = className;
  element.setAttribute("aria-hidden", "true");
  document.body.append(element);
  return element;
}

function place(element: HTMLElement, rect: DOMRect): void {
  element.style.transform = `translate(${rect.left + window.scrollX}px, ${rect.top + window.scrollY}px)`;
  element.style.width = `${rect.width}px`;
  element.style.height = `${rect.height}px`;
}

let commentMode = false;
const hover = overlay("prototypeHost-hover");
const hoverLabel = document.createElement("span");
hoverLabel.className = "prototypeHost-hoverLabel";
hover.append(hoverLabel);
hover.hidden = true;

function onPointerMove(event: PointerEvent): void {
  if (!commentMode || !(event.target instanceof Element)) return;
  const root = contentRoot();
  if (!root.contains(event.target)) {
    hover.hidden = true;
    return;
  }
  const { element } = nearestComponent(event.target, root);
  const described = describeElement(element, root);
  hoverLabel.textContent = described.component;
  place(hover, element.getBoundingClientRect());
  hover.hidden = false;
}

async function onClick(event: MouseEvent): Promise<void> {
  if (!commentMode || !(event.target instanceof Element)) return;
  const root = contentRoot();
  if (!root.contains(event.target)) return;
  event.preventDefault();
  event.stopPropagation();
  const { element } = nearestComponent(event.target, root);
  const described = describeElement(element, root);
  let image: string | null = null;
  try {
    const { toPng } = await import("html-to-image");
    image = await toPng(element as HTMLElement, { pixelRatio: 1, cacheBust: false, fontEmbedCSS: await fontEmbedCss() });
  } catch {
    image = null;
  }
  post({ type: "element-selected", element: { ...described, image } });
}

function setCommentMode(on: boolean): void {
  commentMode = on;
  document.documentElement.toggleAttribute("data-comment-mode", on);
  if (!on) hover.hidden = true;
  post({ type: "comment-mode", on });
}

let pins: { id: string; locator: string; label: string; marker: HTMLDivElement }[] = [];

function layoutPins(): void {
  const root = contentRoot();
  post({
    type: "pins",
    pins: pins.map((pin) => {
      const element = findByLocator(root, pin.locator);
      pin.marker.hidden = !element;
      if (!element) return { id: pin.id, rect: null };
      const rect = element.getBoundingClientRect();
      pin.marker.style.transform = `translate(${rect.right + window.scrollX}px, ${rect.top + window.scrollY}px)`;
      return { id: pin.id, rect: { x: rect.left, y: rect.top, width: rect.width, height: rect.height } };
    }),
  });
}

function setPins(next: readonly { id: string; locator: string; label: string }[]): void {
  for (const pin of pins) pin.marker.remove();
  pins = next.map((pin) => {
    const marker = overlay("prototypeHost-pin");
    marker.textContent = pin.label;
    marker.dataset.pin = pin.id;
    return { ...pin, marker };
  });
  layoutPins();
}

let highlights: HTMLDivElement[] = [];

function highlight(selectors: readonly string[]): void {
  for (const element of highlights) element.remove();
  highlights = [];
  for (const selector of selectors) {
    let element: Element | null = null;
    try {
      element = document.querySelector(selector);
    } catch {
      element = null;
    }
    if (!element) continue;
    const box = overlay("prototypeHost-highlight");
    place(box, element.getBoundingClientRect());
    highlights.push(box);
    element.scrollIntoView({ block: "center" });
  }
}

let fontCss: Promise<string> | null = null;

/**
 * The runtime's Latin font faces with their files inlined, for images.
 * html-to-image would otherwise fetch every face it finds, resolving their
 * addresses through a base URL the frame's policy forbids; prototypes use
 * fictional English data, so the Latin faces are the ones that render.
 */
function fontEmbedCss(): Promise<string> {
  fontCss ??= (async () => {
    const href = document.querySelector<HTMLLinkElement>('link[rel="stylesheet"][href$="/runtime.css"]')?.href;
    if (!href) return "";
    const css = await (await fetch(href)).text();
    const faces = (css.match(/@font-face\s*\{[^}]*\}/g) ?? []).filter((face) => !face.includes("unicode-range") || /U\+0000-00FF/i.test(face));
    const inlined = await Promise.all(
      faces.map(async (face) => {
        // The woff2 source only; every browser that runs the runtime reads it.
        const source = /url\("?([^")]+\.woff2)"?\)/.exec(face)?.[1];
        if (!source) return "";
        const blob = await (await fetch(new URL(source, href))).blob();
        const data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(blob);
        });
        return face.replace(/src:[^;}]*/, `src:url("${data}") format("woff2")`);
      }),
    );
    return inlined.filter(Boolean).join("\n");
  })().catch(() => "");
  return fontCss;
}

/**
 * Runs `work` with animation frames driven by a timer. The page captures in a
 * frame it keeps off screen, where the browser runs no animation frames, and
 * html-to-image waits for one before it draws.
 */
async function withTimerFrames<T>(work: () => Promise<T>): Promise<T> {
  const original = window.requestAnimationFrame;
  window.requestAnimationFrame = (callback) => window.setTimeout(() => callback(performance.now()), 0);
  try {
    return await work();
  } finally {
    window.requestAnimationFrame = original;
  }
}

async function capture(width: number, height: number): Promise<void> {
  try {
    const { toPng } = await import("html-to-image");
    const fontEmbedCSS = await fontEmbedCss();
    const dataUrl = await withTimerFrames(() => toPng(document.body, { width, height, canvasWidth: width, canvasHeight: height, pixelRatio: 1, fontEmbedCSS }));
    post({ type: "capture-result", dataUrl });
  } catch (error) {
    post({ type: "capture-error", message: (error as Error).message });
  }
}

window.addEventListener("message", (event) => {
  if (event.source !== window.parent) return;
  const message = readMessage<PageMessage>(event.data, PAGE_MESSAGE_TYPES);
  if (!message) return;
  if (message.type === "run-audit") void runAudit();
  else if (message.type === "set-comment-mode") setCommentMode(message.on);
  else if (message.type === "set-pins") setPins(message.pins);
  else if (message.type === "highlight") highlight(message.selectors);
  else if (message.type === "capture") void capture(message.width, message.height);
});
document.addEventListener("pointermove", onPointerMove, true);
document.addEventListener("click", (event) => void onClick(event), true);
new ResizeObserver(() => layoutPins()).observe(document.documentElement);
window.addEventListener("resize", () => layoutPins());

const container = document.getElementById("prototype-root");
if (container && config) {
  if (config.title) document.title = config.title;
  // The version's CSS module, compiled by the build gate, as a stylesheet the frame's CSP admits by its nonce.
  const stylesheet = (globalThis as Record<string, unknown>)[CSS_GLOBAL];
  if (typeof stylesheet === "string" && stylesheet) {
    const style = document.createElement("style");
    style.nonce = config.styleNonce;
    style.dataset.prototypeStyles = "";
    style.textContent = stylesheet;
    document.head.append(style);
  }
  if (registered) {
    createRoot(container).render(
      <StrictMode>
        <Prototype component={registered} />
      </StrictMode>,
    );
  } else {
    post({ type: "render-error", message: "The version's code didn't register a component, so there is nothing to render." });
  }
}
