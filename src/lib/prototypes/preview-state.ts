import { DENSITIES, type Density } from "@/prototypes/runtime/protocol";

/**
 * A preview's mode, density, and device (prototypes/preview spec, "Preview
 * controls set mode, density, and device width"). They live in the page's
 * address, so a copied link reproduces them; defaults are left out of it.
 */

export const DEVICES = {
  mobile: { label: "Mobile", width: 375, height: 812, icon: "smartphone" },
  tablet: { label: "Tablet", width: 768, height: 1024, icon: "tablet" },
  desktop: { label: "Desktop", width: 1280, height: 800, icon: "monitor" },
} as const;

export type DeviceId = keyof typeof DEVICES;
export const DEVICE_IDS = Object.keys(DEVICES) as DeviceId[];

export const MODES = { light: "Light", dark: "Dark" } as const;
export type Mode = keyof typeof MODES;

export const DENSITY_LABELS: Record<Density, string> = { high: "High", medium: "Medium", low: "Low", touch: "Touch" };

export type Orientation = "portrait" | "landscape";

/** Each device's natural orientation; Landscape turns a phone or tablet on its side. */
const NATURAL: Record<DeviceId, Orientation> = { mobile: "portrait", tablet: "portrait", desktop: "landscape" };

export interface FramePreview {
  readonly mode: Mode;
  readonly density: Density;
  readonly device: DeviceId;
  readonly orientation: Orientation;
}

export const DEFAULT_PREVIEW: FramePreview = { mode: "light", density: "medium", device: "desktop", orientation: "landscape" };

/** The frame's size: the device's, with width and height swapped when it is turned from its natural orientation. */
export function frameSize(state: Pick<FramePreview, "device" | "orientation">): { width: number; height: number } {
  const { width, height } = DEVICES[state.device];
  return state.orientation === NATURAL[state.device] ? { width, height } : { width: height, height: width };
}

type Query = URLSearchParams | Record<string, string | string[] | undefined>;

function read(query: Query, name: string): string | undefined {
  const value = query instanceof URLSearchParams ? query.get(name) : query[name];
  return typeof value === "string" ? value : undefined;
}

export function parseFramePreview(query: Query): FramePreview {
  const mode = read(query, "mode") === "dark" ? "dark" : "light";
  const density = DENSITIES.find((value) => value === read(query, "density")) ?? DEFAULT_PREVIEW.density;
  const device = DEVICE_IDS.find((value) => value === read(query, "device")) ?? DEFAULT_PREVIEW.device;
  const turned = read(query, "orientation");
  const orientation = turned === "portrait" || turned === "landscape" ? turned : NATURAL[device];
  return { mode, density, device, orientation };
}

/** The choices that differ from the defaults, as query values. */
export function previewQuery(state: FramePreview, omit?: keyof FramePreview): Record<string, string> {
  const query: Record<string, string> = {};
  for (const key of ["mode", "density", "device"] as const) if (key !== omit && state[key] !== DEFAULT_PREVIEW[key]) query[key] = state[key];
  // Orientation is kept only while it differs from the device's natural one; choosing another device resets it.
  if (omit !== "orientation" && omit !== "device" && state.orientation !== NATURAL[state.device]) query.orientation = state.orientation;
  return query;
}

/** A version's frame address at a mode and density; the device is the frame's own width. */
export function renderSrc(base: string, state: Pick<FramePreview, "mode" | "density">): string {
  const query = new URLSearchParams();
  if (state.mode !== DEFAULT_PREVIEW.mode) query.set("mode", state.mode);
  if (state.density !== DEFAULT_PREVIEW.density) query.set("density", state.density);
  const search = query.toString();
  return search ? `${base}?${search}` : base;
}
