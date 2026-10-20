/*
 * The preview's device toolbar (experience-editor spec, "The preview has a
 * device toolbar" and the requirements after it; design decision 6): a
 * device, a size, an orientation, and a zoom, kept per browser tab and never
 * part of the experience. Pure functions, so the toolbar and its tests share
 * them.
 */

export const MIN_SIZE = 320;
export const MAX_SIZE = 2560;

export interface DevicePreset {
  readonly id: string;
  readonly label: string;
  readonly width: number;
  readonly height: number;
}

/** Responsive first, then fixed devices, each in portrait as Chrome's device toolbar lists them. */
export const DEVICE_PRESETS: readonly DevicePreset[] = [
  { id: "responsive", label: "Responsive", width: 1440, height: 900 },
  { id: "desktop", label: "Desktop", width: 1440, height: 900 },
  { id: "laptop", label: "Laptop", width: 1280, height: 800 },
  { id: "tablet", label: "Tablet", width: 768, height: 1024 },
  { id: "ipad-pro", label: "iPad Pro", width: 1024, height: 1366 },
  { id: "iphone-14", label: "iPhone 14", width: 390, height: 844 },
  { id: "pixel-7", label: "Pixel 7", width: 412, height: 915 },
];

export const ZOOMS = ["fit", 50, 75, 100] as const;
export type Zoom = (typeof ZOOMS)[number];

export interface DeviceState {
  readonly device: string;
  readonly width: number;
  readonly height: number;
  /** Whether a named device is turned to landscape. */
  readonly rotated: boolean;
  readonly zoom: Zoom;
}

export const DEFAULT_DEVICE: DeviceState = { device: "responsive", width: 1440, height: 900, rotated: false, zoom: "fit" };

/** A size within the range the fields and handles accept. */
export function clampSize(value: number): number {
  if (!Number.isFinite(value)) return MIN_SIZE;
  return Math.min(MAX_SIZE, Math.max(MIN_SIZE, Math.round(value)));
}

/** Chooses a device: its size, turned to the current orientation. Responsive keeps the current size. */
export function chooseDevice(state: DeviceState, id: string): DeviceState {
  const preset = DEVICE_PRESETS.find((candidate) => candidate.id === id);
  if (!preset) return state;
  if (preset.id === "responsive") return { ...state, device: "responsive" };
  const [width, height] = state.rotated ? [preset.height, preset.width] : [preset.width, preset.height];
  return { ...state, device: preset.id, width, height };
}

/** Swaps the width and height, for a named device and Responsive alike. */
export function rotate(state: DeviceState): DeviceState {
  return { ...state, width: state.height, height: state.width, rotated: !state.rotated };
}

/** A size set by the fields or the handles: always Responsive. +clamp+ is false while a field is being typed in, and true when it's left. */
export function resize(state: DeviceState, size: { width?: number; height?: number }, clamp = true): DeviceState {
  const fix = (value: number) => (clamp ? clampSize(value) : Math.max(1, Math.round(value)));
  return { ...state, device: "responsive", width: size.width === undefined ? state.width : fix(size.width), height: size.height === undefined ? state.height : fix(size.height) };
}

/** Which way the preview is turned, as assistive technology hears it. */
export function orientationOf(state: Pick<DeviceState, "width" | "height">): "Landscape" | "Portrait" {
  return state.width >= state.height ? "Landscape" : "Portrait";
}

/** The scale the preview is drawn at: Fit scales it to the width +available+, never past full size; a fixed zoom is that percentage. */
export function scaleOf(state: Pick<DeviceState, "width" | "zoom">, available: number): number {
  if (state.zoom !== "fit") return state.zoom / 100;
  return available > 0 ? Math.min(1, available / state.width) : 1;
}

/** Whether the frame is drawn in its phone layout. */
export function isPhone(width: number): boolean {
  return width < 768;
}

/** A state read back from storage, or the default when it isn't one. */
export function parseDeviceState(value: unknown): DeviceState {
  if (typeof value !== "object" || value === null) return DEFAULT_DEVICE;
  const candidate = value as Record<string, unknown>;
  const device = typeof candidate.device === "string" && DEVICE_PRESETS.some((preset) => preset.id === candidate.device) ? candidate.device : DEFAULT_DEVICE.device;
  const size = (key: "width" | "height") => (typeof candidate[key] === "number" ? clampSize(candidate[key] as number) : DEFAULT_DEVICE[key]);
  const zoom = (ZOOMS as readonly unknown[]).includes(candidate.zoom) ? (candidate.zoom as Zoom) : DEFAULT_DEVICE.zoom;
  return { device, width: size("width"), height: size("height"), rotated: candidate.rotated === true, zoom };
}
