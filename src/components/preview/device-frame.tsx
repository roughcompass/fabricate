"use client";

import { createContext, use, useEffect, useRef, useState } from "react";
import { buttonProps } from "@/components/ui/button-content";
import { Icon } from "@/components/ui/icon";
import { Tooltip } from "@/components/ui/tooltip";
import styles from "./device-frame.module.css";
import { percentOf } from "@/components/ui/count";

/** The browser window's border, left and right: 1px each. */
const WINDOW_BORDER = 2;

/** The scale the frame is shown at, which the frame measures and the size label in the control row reports. */
const ScaleContext = createContext<{ scale: number; setScale(scale: number): void }>({ scale: 1, setScale: () => {} });

export function PreviewScale({ children }: { children: React.ReactNode }) {
  const [scale, setScale] = useState(1);
  return <ScaleContext value={{ scale, setScale }}>{children}</ScaleContext>;
}

/** The device's size, and the scale when the frame is shown smaller than that, for the control row. */
export function FrameSize({ label }: { label: string }) {
  const { scale } = use(ScaleContext);
  return (
    <p className={styles.size}>
      <span data-frame-size="">{label}</span>
      {scale < 1 && <span className={styles.scale}>{`Shown at ${percentOf(scale, 1)}%`}</span>}
    </p>
  );
}

/**
 * A page running in a frame at a device's size, inside a browser window that
 * shows its address (template-preview design.md, decision 6): a template's
 * reference deployment, or a repository preview. The page inside lays out at
 * the device's size, so its own breakpoints apply; when the device is wider
 * than the space inside the gray container's padding, the window and the
 * frame scale down together to fit. The title bar keeps its height, and is
 * decoration only. `FrameSize` reports the scale.
 */
export function DeviceFrame({ src, width, height, title, address }: { src: string; width: number; height: number; title: string; address: string }) {
  const viewport = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState<number | null>(null);
  const { setScale } = use(ScaleContext);

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setAvailable(entry!.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // The window's border sits outside the frame, so the frame fits in what the border leaves.
  const scale = available ? Math.min(1, (available - WINDOW_BORDER) / width) : 1;
  useEffect(() => setScale(scale), [scale, setScale]);
  return (
    <div ref={viewport} className={styles.viewport} data-preview-container="">
      <div className={styles.window} style={{ width: width * scale + WINDOW_BORDER }} data-browser-window="">
        <div className={styles.titleBar} aria-hidden="true" data-title-bar="">
          <span className={styles.dots}>
            <span className={styles.dot} />
            <span className={styles.dot} />
            <span className={styles.dot} />
          </span>
          <span className={styles.address}>{address}</span>
        </div>
        <div className={styles.device} style={{ width: width * scale, height: height * scale }} data-device-frame="">
          <iframe src={src} title={title} className={styles.frame} style={{ width, height, transform: `scale(${scale})` }} data-preview-frame="" />
        </div>
      </div>
    </div>
  );
}

/**
 * Opens what the frame shows in a new tab, at the route it shows now: the
 * visitor may have navigated inside it. +prefix+ is the path the frame's
 * routes start with; with +withQuery+, the route keeps its query and
 * fragment, which a single-page application may route by. With +to+, the
 * route opens under +to+ in place of +prefix+, as an application's build
 * opens running under the toolbar. An icon button, named and with a tooltip.
 */
export function FullScreenLink({ href, prefix, withQuery = false, to, tooltip = "Open full screen" }: { href: string; prefix: string; withQuery?: boolean; to?: string; tooltip?: string }) {
  return (
    <Tooltip content={tooltip}>
      <a
        href={href}
        target="_blank"
        rel="noopener"
        {...buttonProps("secondary", "sm", true)}
        onClick={(event) => {
          const frame = document.querySelector<HTMLIFrameElement>("[data-preview-frame]");
          try {
            const location = frame?.contentWindow?.location;
            if (location?.pathname.startsWith(prefix)) {
              const path = to === undefined ? location.pathname : `${to}/${location.pathname.slice(prefix.length).replace(/^\/+/, "")}`.replace(/\/$/, "");
              event.currentTarget.href = withQuery ? `${path}${location.search}${location.hash}` : path;
            }
          } catch {
            // The frame is always same-origin; keep the start route if it cannot be read.
          }
        }}
      >
        <Icon name="external" size={16} />
        <span className="visually-hidden">Open full screen (opens in a new tab)</span>
      </a>
    </Tooltip>
  );
}
