import { buttonProps } from "@/components/ui/button-content";
import { Icon } from "@/components/ui/icon";
import { ToggleGroup } from "@/components/ui/toggle-group";
import { Tooltip } from "@/components/ui/tooltip";
import { LandscapeToggle } from "@/components/ui/landscape-toggle";
import { DENSITY_LABELS, DEVICES, DEVICE_IDS, type FramePreview, MODES, previewQuery, renderSrc } from "@/lib/prototypes/preview-state";
import { DENSITIES } from "@/prototypes/runtime/protocol";
import styles from "./preview-controls.module.css";

/**
 * The preview's controls (prototypes/preview spec, "Preview controls set
 * mode, density, and device width"): Mode, Density, and Device, each a
 * toggle group whose choice lives in the address, so a copied link
 * reproduces it; Landscape for a phone or tablet; and Open full screen,
 * which opens the version on its own in a new tab at the current mode and
 * density.
 */
export function PreviewControls({ action, state, keep = {}, frameBase }: { action: string; state: FramePreview; keep?: Record<string, string>; frameBase?: string }) {
  const keepWithout = (omit: keyof FramePreview) => ({ ...keep, ...previewQuery(state, omit) });
  return (
    <div className={styles.controls} data-preview-controls="">
      <ToggleGroup action={action} label="Mode" name="mode" selected={state.mode} keep={keepWithout("mode")} options={Object.entries(MODES).map(([value, label]) => ({ value, label, icon: value === "dark" ? "moon" : "sun" }))} />
      <ToggleGroup action={action} label="Density" name="density" selected={state.density} keep={keepWithout("density")} options={DENSITIES.map((value) => ({ value, label: DENSITY_LABELS[value] }))} />
      <ToggleGroup action={action} label="Device" name="device" selected={state.device} keep={keepWithout("device")} iconOnly options={DEVICE_IDS.map((value) => ({ value, label: DEVICES[value].label, icon: DEVICES[value].icon }))} />
      {state.device !== "desktop" && <LandscapeToggle action={action} orientation={state.orientation} keep={keepWithout("orientation")} />}
      {frameBase && (
        <Tooltip content="Open full screen">
          <a href={renderSrc(frameBase, state)} target="_blank" rel="noopener" {...buttonProps("secondary", "sm", true)} data-open-new-tab="">
            <Icon name="external" size={16} />
            <span className="visually-hidden">Open full screen (opens in a new tab)</span>
          </a>
        </Tooltip>
      )}
    </div>
  );
}
