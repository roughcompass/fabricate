"use client";

import { useRouter } from "next/navigation";
import { buttonProps } from "@/components/ui/button-content";
import { Icon } from "@/components/ui/icon";
import { Tooltip } from "@/components/ui/tooltip";
import styles from "./landscape-toggle.module.css";

export type Orientation = "portrait" | "landscape";

const withClass = <T extends { className: string }>(props: T, extra: string | undefined): T => ({ ...props, className: [props.className, extra].filter(Boolean).join(" ") });

/**
 * The Landscape toggle: one icon button, pressed while the device is on its
 * side, that turns it the other way (template-demo design.md, decision 5). Template
 * preview and the prototype preview share it. Like the device
 * choice it is a GET form, so it works without JavaScript, and with
 * JavaScript it navigates in place.
 */
export function LandscapeToggle({ action, orientation, keep }: { action: string; orientation: Orientation; keep: Record<string, string> }) {
  const router = useRouter();
  const next: Orientation = orientation === "landscape" ? "portrait" : "landscape";
  return (
    <form
      action={action}
      method="get"
      onSubmit={(event) => {
        event.preventDefault();
        const params = new URLSearchParams(keep);
        params.set("orientation", next);
        router.push(`${action}?${params}`, { scroll: false });
      }}
    >
      {Object.entries(keep).map(([key, value]) => (
        <input key={key} type="hidden" name={key} value={value} />
      ))}
      <Tooltip content="Landscape">
        <button type="submit" name="orientation" value={next} {...withClass(buttonProps("secondary", "sm", true), styles.toggle)} aria-label="Landscape" aria-pressed={orientation === "landscape"}>
          <Icon name="rotate" size={16} />
        </button>
      </Tooltip>
    </form>
  );
}
