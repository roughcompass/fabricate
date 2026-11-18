/**
 * Preview mode's state (template-preview spec, design.md decision 19): the
 * tab, the device, and its orientation, all kept in the address so a reload
 * or a shared link reproduces the same preview.
 */

export const DEVICES = {
  mobile: { label: "Mobile", width: 390, height: 844, orientation: "portrait" },
  tablet: { label: "Tablet", width: 820, height: 1180, orientation: "portrait" },
  desktop: { label: "Desktop", width: 1440, height: 900, orientation: "landscape" },
} as const;

export type DeviceId = keyof typeof DEVICES;
export type Orientation = "portrait" | "landscape";
type PreviewView = "preview" | "code";

export const DEVICE_IDS = Object.keys(DEVICES) as DeviceId[];
export const ORIENTATION_LABELS: Record<Orientation, string> = { portrait: "Portrait", landscape: "Landscape" };

export interface PreviewState {
  readonly view: PreviewView;
  readonly device: DeviceId;
  readonly orientation: Orientation;
  /** The file the Code tab shows; null for the first. */
  readonly file: string | null;
}

type Params = Readonly<Record<string, string | string[] | undefined>>;

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export function parsePreviewState(params: Params): PreviewState {
  const device = DEVICE_IDS.find((id) => id === first(params.device)) ?? "desktop";
  const orientation = first(params.orientation);
  const file = first(params.file);
  return {
    view: first(params.view) === "code" ? "code" : "preview",
    device,
    orientation: orientation === "portrait" || orientation === "landscape" ? orientation : DEVICES[device].orientation,
    file: file && file.length <= 200 ? file : null,
  };
}

/** The frame's size: the device's size, with width and height swapped when its orientation is turned. */
export function frameSize(device: DeviceId, orientation: Orientation): { width: number; height: number } {
  const { width, height } = DEVICES[device];
  const portrait = Math.min(width, height);
  const landscape = Math.max(width, height);
  return orientation === "landscape" ? { width: landscape, height: portrait } : { width: portrait, height: landscape };
}

export function sizeLabel(device: DeviceId, orientation: Orientation): string {
  const { width, height } = frameSize(device, orientation);
  return `${width} × ${height}`;
}

/** Preview mode's address for a state, leaving out the defaults. */
export function previewHref(slug: string, state: PreviewState): string {
  const params = new URLSearchParams();
  if (state.view === "code") params.set("view", "code");
  if (state.device !== "desktop") params.set("device", state.device);
  if (state.orientation !== DEVICES[state.device].orientation) params.set("orientation", state.orientation);
  if (state.view === "code" && state.file) params.set("file", state.file);
  return `/templates/${slug}/preview${params.size ? `?${params}` : ""}`;
}

/** The command that scaffolds a template locally. The package is fictional: the demo never runs it. */
export function scaffoldCommand(slug: string): string {
  return `npx @deweb/create-app@latest my-app --template ${slug}`;
}
