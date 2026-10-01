"use client";

import { useEffect, useRef, useState } from "react";
import { ButtonContent, buttonProps } from "@/components/ui/button-content";
import styles from "./preview.module.css";

/**
 * The reference deployment, running in a frame at a device's size. The
 * application inside lays out at that size, so its own breakpoints apply;
 * when the device is wider than the space available, the frame scales down
 * to fit.
 */
export function DeviceFrame({ src, width, height, title, label }: { src: string; width: number; height: number; title: string; label: string }) {
  const viewport = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState<number | null>(null);

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setAvailable(entry!.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const scale = available ? Math.min(1, available / width) : 1;
  return (
    <div className={styles.stage}>
      <p className={styles.size}>
        <span data-frame-size="">{label}</span>
        {scale < 1 && <span className={styles.scale}>{`Shown at ${Math.round(scale * 100)}%`}</span>}
      </p>
      <div ref={viewport} className={styles.viewport}>
        <div className={styles.device} style={{ width: width * scale, height: height * scale }} data-device-frame="">
          <iframe src={src} title={title} className={styles.frame} style={{ width, height, transform: `scale(${scale})` }} data-preview-frame="" />
        </div>
      </div>
    </div>
  );
}

/**
 * Opens the reference deployment with its toolbar in a new tab, at the route
 * the frame shows now: the visitor may have navigated inside it.
 */
export function FullScreenLink({ href, prefix }: { href: string; prefix: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener"
      {...buttonProps("secondary", "sm")}
      onClick={(event) => {
        const frame = document.querySelector<HTMLIFrameElement>("[data-preview-frame]");
        try {
          const path = frame?.contentWindow?.location.pathname;
          if (path?.startsWith(prefix)) event.currentTarget.href = path;
        } catch {
          // The frame is always same-origin; keep the start route if it cannot be read.
        }
      }}
    >
      <ButtonContent icon="external" size="sm">
        Open full screen
        <span className="visually-hidden"> (opens in a new tab)</span>
      </ButtonContent>
    </a>
  );
}
