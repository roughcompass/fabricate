import { LandscapeToggle } from "@/components/ui/landscape-toggle";
import { ToggleGroup } from "@/components/ui/toggle-group";
import { DEVICES, DEVICE_IDS, type DeviceState, sizeLabel } from "@/lib/web/device-preview";
import { FrameSize, FullScreenLink } from "./device-frame";
import styles from "./device-frame.module.css";

const DEVICE_ICONS = { mobile: "smartphone", tablet: "tablet", desktop: "monitor" } as const;

/**
 * A device preview's controls, at the end of its control row: the frame's
 * size, the device, Landscape, and, when the frame's page can stand on its
 * own, Open full screen. Each choice is a GET form to +action+ that keeps
 * +keep+, the page's other query values, so it works without JavaScript;
 * choosing a device starts it in its own orientation.
 */
export function DeviceControls({ action, state, keep = {}, fullScreen }: { action: string; state: DeviceState; keep?: Record<string, string>; fullScreen?: React.ComponentProps<typeof FullScreenLink> }) {
  return (
    <div className={styles.controls}>
      <FrameSize label={sizeLabel(state.device, state.orientation)} />
      <ToggleGroup
        action={action}
        label="Device"
        name="device"
        selected={state.device}
        keep={keep}
        iconOnly
        options={DEVICE_IDS.map((id) => ({ value: id, label: DEVICES[id].label, icon: DEVICE_ICONS[id] }))}
      />
      <LandscapeToggle action={action} orientation={state.orientation} keep={{ ...keep, device: state.device }} />
      {fullScreen && <FullScreenLink {...fullScreen} />}
    </div>
  );
}
