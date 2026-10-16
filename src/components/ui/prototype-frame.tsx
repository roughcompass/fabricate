"use client";

import { useEffect, useRef, useState } from "react";
import { FRAME_MESSAGE_TYPES, type FrameMessage, type PageMessage, envelope, readMessage } from "@/prototypes/runtime/protocol";
import styles from "./prototype-frame.module.css";

export interface FramePin {
  readonly id: string;
  readonly locator: string;
  readonly label: string;
}

interface PrototypeFrameProps {
  /** The version's frame address, with its mode and density. */
  src: string;
  /** The frame's own width and height: a device's size. */
  width: number;
  height: number;
  title: string;
  /** "fit" scales the frame down to the space it has; a number fixes the scale. */
  scale?: "fit" | number;
  /** A caption above the frame, such as the device's size. */
  label?: string;
  commentMode?: boolean;
  pins?: readonly FramePin[];
  /** Elements to outline, by the selectors the audit reported. */
  highlight?: readonly string[];
  /** Asks the frame to run the accessibility audit once it is ready. */
  audit?: boolean;
  /** Each new value asks the frame for one capture of this size. */
  capture?: { readonly token: number; readonly width: number; readonly height: number } | null;
  onFrameMessage?: (message: FrameMessage) => void;
  /** Renders the frame off screen and out of the accessibility tree, for the audit frame. */
  hidden?: boolean;
}

/**
 * A version's preview (design.md, decisions 8 and 15): the version runs in a
 * frame sandboxed to scripts only, so it has an opaque origin, can't read DE
 * FabLab's cookies or script this page, and sends no cookies itself. The page
 * and the frame talk only through the typed messages in the runtime's
 * protocol, and messages from anything but this frame are ignored. The frame
 * lays out at the device's width, so the prototype's own breakpoints apply;
 * with "fit" it scales down to the space it has.
 */
export function PrototypeFrame({ src, width, height, title, scale = "fit", label, commentMode = false, pins, highlight, audit = false, capture = null, onFrameMessage, hidden = false }: PrototypeFrameProps) {
  const frame = useRef<HTMLIFrameElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState<number | null>(null);
  const [ready, setReady] = useState(false);
  const handler = useRef(onFrameMessage);
  useEffect(() => {
    handler.current = onFrameMessage;
  }, [onFrameMessage]);

  // A new address is a new document, which reports ready again.
  const [readyFor, setReadyFor] = useState(src);
  if (readyFor !== src) {
    setReadyFor(src);
    setReady(false);
  }

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!frame.current || event.source !== frame.current.contentWindow) return;
      const message = readMessage<FrameMessage>(event.data, FRAME_MESSAGE_TYPES);
      if (!message) return;
      if (message.type === "ready") setReady(true);
      handler.current?.(message);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  useEffect(() => {
    const element = viewport.current;
    if (!element || scale !== "fit") return;
    const observer = new ResizeObserver(([entry]) => setAvailable(entry!.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, [scale]);

  const send = (message: PageMessage) => frame.current?.contentWindow?.postMessage(envelope(message), "*");
  useEffect(() => {
    if (ready) send({ type: "set-comment-mode", on: commentMode });
  }, [ready, commentMode]);
  useEffect(() => {
    if (ready && pins) send({ type: "set-pins", pins });
  }, [ready, pins]);
  useEffect(() => {
    if (ready && highlight) send({ type: "highlight", selectors: highlight });
  }, [ready, highlight]);
  useEffect(() => {
    if (ready && audit) send({ type: "run-audit" });
  }, [ready, audit]);
  useEffect(() => {
    if (ready && capture) send({ type: "capture", width: capture.width, height: capture.height });
  }, [ready, capture]);

  const factor = typeof scale === "number" ? scale : available ? Math.min(1, available / width) : 1;
  return (
    <div className={hidden ? `${styles.stage} ${styles.offscreen}` : styles.stage} aria-hidden={hidden || undefined} data-prototype-frame-stage="">
      {label && !hidden && (
        <p className={styles.size}>
          <span data-frame-size="">{label}</span>
          {factor < 1 && <span className={styles.scale}>{`Shown at ${Math.round(factor * 100)}%`}</span>}
        </p>
      )}
      <div ref={viewport} className={styles.viewport}>
        <div className={styles.device} style={{ width: width * factor, height: height * factor }} data-device-frame="">
          {/* The frame's messages are checked against its window, since a sandboxed frame's origin is "null". */}
          <iframe
            ref={frame}
            src={src}
            title={title}
            sandbox="allow-scripts"
            className={styles.frame}
            style={{ width, height, transform: `scale(${factor})` }}
            data-prototype-frame=""
            data-ready={ready ? "" : undefined}
            tabIndex={hidden ? -1 : undefined}
            aria-hidden={hidden || undefined}
          />
        </div>
      </div>
    </div>
  );
}
