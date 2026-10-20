"use client";

import { createContext, use, useCallback, useEffect, useState } from "react";
import { Icon } from "@/components/ui/icon";
import { DEFAULT_DEVICE, DEVICE_PRESETS, type DeviceState, MAX_SIZE, MIN_SIZE, ZOOMS, type Zoom, chooseDevice, orientationOf, parseDeviceState, resize, rotate } from "@/lib/experience/device";
import styles from "./device.module.css";

/** Where the toolbar's state is kept for the browser tab. */
const STORAGE_KEY = "fabricate-device";

interface DeviceContextValue {
  readonly device: DeviceState;
  readonly setDevice: (update: (state: DeviceState) => DeviceState) => void;
}

const DeviceContext = createContext<DeviceContextValue | null>(null);

/**
 * The preview's device toolbar state (experience-editor spec, "The device
 * toolbar is kept per tab"; design decision 6): mounted once for Runtime
 * Configuration's pages, kept in session storage so it survives moving
 * between them and a reload, and never part of the experience or its
 * pending changes.
 */
export function DeviceProvider({ children }: { children: React.ReactNode }) {
  const [device, setState] = useState<DeviceState>(DEFAULT_DEVICE);
  useEffect(() => {
    try {
      const stored = window.sessionStorage.getItem(STORAGE_KEY);
      // Read after hydration, so the server and the first client render agree.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (stored) setState(parseDeviceState(JSON.parse(stored)));
    } catch {
      // No stored state, or storage is unavailable: the default stands.
    }
  }, []);
  const setDevice = useCallback((update: (state: DeviceState) => DeviceState) => {
    setState((current) => {
      const next = update(current);
      try {
        window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Storage is unavailable: the state lasts for this page only.
      }
      return next;
    });
  }, []);
  return <DeviceContext value={{ device, setDevice }}>{children}</DeviceContext>;
}

export function useDevice(): DeviceContextValue {
  const value = use(DeviceContext);
  if (!value) throw new Error("useDevice must be used inside DeviceProvider");
  return value;
}

const ZOOM_LABELS: Record<string, string> = { fit: "Fit", 50: "50%", 75: "75%", 100: "100%" };

/** A size field: typed values apply as they're typed, and are clamped to the range when the field is left. */
function SizeField({ id, label, value, onChange }: { id: string; label: string; value: number; onChange: (value: number, clamp: boolean) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      id={id}
      className={styles.size}
      type="number"
      inputMode="numeric"
      min={MIN_SIZE}
      max={MAX_SIZE}
      aria-label={label}
      title={label}
      value={draft ?? String(value)}
      onChange={(event) => {
        setDraft(event.target.value);
        const parsed = Number.parseInt(event.target.value, 10);
        if (Number.isFinite(parsed) && parsed > 0) onChange(parsed, false);
      }}
      onBlur={(event) => {
        setDraft(null);
        onChange(Number.parseInt(event.target.value, 10), true);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
    />
  );
}

/**
 * The device toolbar above the preview (experience-editor spec, "The preview
 * has a device toolbar"), styled after Chrome's: the device menu, the width
 * and height, Rotate, the zoom menu, and the scale the preview is drawn at.
 */
export function DeviceToolbar({ scale }: { scale: number }) {
  const { device, setDevice } = useDevice();
  const orientation = orientationOf(device);
  return (
    <div className={styles.toolbar} role="toolbar" aria-label="Device toolbar" data-device-toolbar="">
      <select className={styles.select} aria-label="Device" title="Device" value={device.device} onChange={(event) => setDevice((state) => chooseDevice(state, event.target.value))}>
        {DEVICE_PRESETS.map((preset) => (
          <option key={preset.id} value={preset.id}>
            {preset.id === "responsive" ? preset.label : `${preset.label} (${preset.width} × ${preset.height})`}
          </option>
        ))}
      </select>
      <span className={styles.dimensions}>
        <SizeField id="device-width" label="Width" value={device.width} onChange={(width, clamp) => setDevice((state) => resize(state, { width }, clamp))} />
        <span aria-hidden="true">×</span>
        <SizeField id="device-height" label="Height" value={device.height} onChange={(height, clamp) => setDevice((state) => resize(state, { height }, clamp))} />
      </span>
      <button type="button" className={styles.button} aria-label={`Rotate, now ${orientation}`} title="Rotate" onClick={() => setDevice(rotate)} data-orientation={orientation.toLowerCase()}>
        <Icon name="rotate" size={16} />
      </button>
      <span className="visually-hidden" role="status">
        {orientation}
      </span>
      <select className={styles.select} aria-label="Zoom" title="Zoom" value={String(device.zoom)} onChange={(event) => setDevice((state) => ({ ...state, zoom: (event.target.value === "fit" ? "fit" : Number(event.target.value)) as Zoom }))}>
        {ZOOMS.map((zoom) => (
          <option key={zoom} value={String(zoom)}>
            {ZOOM_LABELS[String(zoom)]}
          </option>
        ))}
      </select>
      <span className={styles.scale} data-preview-scale="">{`${Math.round(scale * 100)}%`}</span>
    </div>
  );
}
