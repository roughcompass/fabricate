import { type SearchParams, oneOf } from "./query";
/**
 * A device preview's frame (template-preview spec, design.md decision 19;
 * repository-previews spec "Previews are viewed in a device frame"): the
 * device and its orientation, kept in the address so a reload or a shared
 * link shows the same frame. Template preview and repository previews share
 * it.
 */

export const DEVICES = {
  mobile: { label: "Mobile", width: 390, height: 844, orientation: "portrait" },
  tablet: { label: "Tablet", width: 820, height: 1180, orientation: "portrait" },
  desktop: { label: "Desktop", width: 1440, height: 900, orientation: "landscape" },
} as const;

export type DeviceId = keyof typeof DEVICES;
export type Orientation = "portrait" | "landscape";

export const DEVICE_IDS = Object.keys(DEVICES) as DeviceId[];
export const ORIENTATION_LABELS: Record<Orientation, string> = { portrait: "Portrait", landscape: "Landscape" };

export interface DeviceState {
  readonly device: DeviceId;
  readonly orientation: Orientation;
}

type Params = SearchParams;

/** The device and orientation in a page's query: Desktop by default, each device in its own orientation unless one is given. */
export function parseDeviceState(params: Params): DeviceState {
  const device = oneOf(params, "device", DEVICE_IDS) ?? "desktop";
  return { device, orientation: oneOf(params, "orientation", ["portrait", "landscape"] as const) ?? DEVICES[device].orientation };
}

/** The query that keeps a device state, leaving out the defaults. */
export function deviceQuery(state: DeviceState): Record<string, string> {
  return {
    ...(state.device !== "desktop" && { device: state.device }),
    ...(state.orientation !== DEVICES[state.device].orientation && { orientation: state.orientation }),
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
