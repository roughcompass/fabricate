import { type DeviceState, deviceQuery, parseDeviceState } from "@/lib/web/device-preview";
import { type SearchParams, param } from "@/lib/web/query";

/**
 * Preview mode's state (template-preview spec, design.md decision 19): the
 * tab, the device, and its orientation, all kept in the address so a reload
 * or a shared link reproduces the same preview. The device and its
 * orientation are shared with repository previews (src/lib/web/device-preview.ts).
 */

type PreviewView = "preview" | "code";

export interface PreviewState extends DeviceState {
  readonly view: PreviewView;
  /** The file the Code tab shows; null for the first. */
  readonly file: string | null;
}

type Params = SearchParams;

export function parsePreviewState(params: Params): PreviewState {
  const file = param(params, "file");
  return {
    view: param(params, "view") === "code" ? "code" : "preview",
    ...parseDeviceState(params),
    file: file && file.length <= 200 ? file : null,
  };
}

/** Preview mode's address for a state, leaving out the defaults. */
export function previewHref(slug: string, state: PreviewState): string {
  const params = new URLSearchParams();
  if (state.view === "code") params.set("view", "code");
  for (const [name, value] of Object.entries(deviceQuery(state))) params.set(name, value);
  if (state.view === "code" && state.file) params.set("file", state.file);
  return `/templates/${slug}/preview${params.size ? `?${params}` : ""}`;
}

/** The command that scaffolds a template locally. The package is fictional: the demo never runs it. */
export function scaffoldCommand(slug: string): string {
  return `npx @deweb/create-app@latest my-app --template ${slug}`;
}
