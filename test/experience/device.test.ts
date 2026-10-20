import { describe, expect, it } from "vitest";
import { DEFAULT_DEVICE, DEVICE_PRESETS, chooseDevice, clampSize, isPhone, orientationOf, parseDeviceState, resize, rotate, scaleOf } from "@/lib/experience/device";

// experience-editor spec: the preview's device toolbar (update-portal-management-journey task 4.1).

describe("the device toolbar", () => {
  it("lists Responsive first, then the named devices, and starts Responsive at 1440 × 900", () => {
    expect(DEVICE_PRESETS.map((preset) => `${preset.label} ${preset.width} × ${preset.height}`)).toEqual(["Responsive 1440 × 900", "Desktop 1440 × 900", "Laptop 1280 × 800", "Tablet 768 × 1024", "iPad Pro 1024 × 1366", "iPhone 14 390 × 844", "Pixel 7 412 × 915"]);
    expect(DEFAULT_DEVICE).toEqual({ device: "responsive", width: 1440, height: 900, rotated: false, zoom: "fit" });
  });

  it("sets a named device's size, and keeps the size when Responsive is chosen (Choosing a phone)", () => {
    const phone = chooseDevice(DEFAULT_DEVICE, "iphone-14");
    expect(phone).toMatchObject({ device: "iphone-14", width: 390, height: 844 });
    expect(chooseDevice(phone, "responsive")).toMatchObject({ device: "responsive", width: 390, height: 844 });
    expect(chooseDevice(phone, "nothing")).toBe(phone);
  });

  it("swaps the size on Rotate, keeps the orientation for the next device, and says which way it's turned (Landscape phone)", () => {
    const landscape = rotate(chooseDevice(DEFAULT_DEVICE, "iphone-14"));
    expect(landscape).toMatchObject({ width: 844, height: 390, rotated: true });
    expect(orientationOf(landscape)).toBe("Landscape");
    expect(chooseDevice(landscape, "pixel-7")).toMatchObject({ width: 915, height: 412 });
    expect(orientationOf(chooseDevice(DEFAULT_DEVICE, "pixel-7"))).toBe("Portrait");
    expect(rotate(DEFAULT_DEVICE)).toMatchObject({ device: "responsive", width: 900, height: 1440 });
  });

  it("clamps a size to 320–2560 when a field is left, and switches a named device to Responsive (Out of range, Dragging the edge)", () => {
    expect(clampSize(100)).toBe(320);
    expect(clampSize(5000)).toBe(2560);
    expect(clampSize(Number.NaN)).toBe(320);
    expect(clampSize(900.4)).toBe(900);
    const phone = chooseDevice(DEFAULT_DEVICE, "iphone-14");
    expect(resize(phone, { width: 900 })).toMatchObject({ device: "responsive", width: 900, height: 844 });
    expect(resize(phone, { width: 100 })).toMatchObject({ width: 320 });
    // While a field is typed in, the value isn't clamped yet.
    expect(resize(phone, { width: 10 }, false)).toMatchObject({ width: 10 });
  });

  it("scales to fit the width available, never past full size, or to a fixed zoom (Actual size)", () => {
    expect(scaleOf({ width: 1440, zoom: "fit" }, 720)).toBe(0.5);
    expect(scaleOf({ width: 390, zoom: "fit" }, 720)).toBe(1);
    expect(scaleOf({ width: 1440, zoom: "fit" }, 0)).toBe(1);
    expect(scaleOf({ width: 1440, zoom: 75 }, 720)).toBe(0.75);
    expect(scaleOf({ width: 1440, zoom: 100 }, 720)).toBe(1);
  });

  it("draws the phone layout below 768 pixels", () => {
    expect(isPhone(390)).toBe(true);
    expect(isPhone(768)).toBe(false);
  });

  it("reads a stored state back, and falls back to the default for anything else", () => {
    expect(parseDeviceState({ device: "pixel-7", width: 412, height: 915, rotated: false, zoom: 75 })).toEqual({ device: "pixel-7", width: 412, height: 915, rotated: false, zoom: 75 });
    expect(parseDeviceState({ device: "fridge", width: 99999, zoom: 33 })).toEqual({ device: "responsive", width: 2560, height: 900, rotated: false, zoom: "fit" });
    expect(parseDeviceState("nonsense")).toBe(DEFAULT_DEVICE);
  });
});
