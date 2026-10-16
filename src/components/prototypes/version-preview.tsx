"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { type FramePin, PrototypeFrame } from "@/components/ui/prototype-frame";
import { DEVICES, type FramePreview, frameSize, renderSrc } from "@/lib/prototypes/preview-state";
import type { NotedElement } from "@/lib/prototypes/types";
import type { FrameMessage } from "@/prototypes/runtime/protocol";

interface VersionPreviewProps {
  versionId: string;
  title: string;
  state: FramePreview;
  /** The frame's address without its query; defaults to the workspace's render route. */
  frameBase?: string;
  /** Whether the version still needs its first accessibility audit, which then runs alongside the preview. */
  needsAudit?: boolean;
  /** Whether a render error is already recorded, so it isn't reported twice. */
  renderErrorRecorded?: boolean;
  commentMode?: boolean;
  pins?: readonly FramePin[];
  highlight?: readonly string[];
  onElementSelected?: (element: NotedElement) => void;
  /** Reports render errors and audit results to DE FabLab; off for shared views. */
  report?: boolean;
}

async function postJson(url: string, body: unknown): Promise<boolean> {
  try {
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * A version in its frame at the preview's device size, recording what the
 * frame reports (preview spec, "Rendering errors are contained and
 * recorded"; quality-checks spec, "An accessibility audit runs on the
 * rendered version"). The audit runs once, on the version's first render, in
 * a hidden frame at the desktop width in light mode, whatever the visible
 * preview shows.
 */
export function VersionPreview({ versionId, title, state, frameBase = `/prototypes/render/${versionId}`, needsAudit = false, renderErrorRecorded = false, commentMode, pins, highlight, onElementSelected, report = true }: VersionPreviewProps) {
  const router = useRouter();
  const [errorReported, setErrorReported] = useState(renderErrorRecorded);
  const device = DEVICES[state.device];
  const size = frameSize(state);

  const onMessage = (message: FrameMessage) => {
    if (message.type === "render-error" && report && !errorReported) {
      setErrorReported(true);
      void postJson(`/api/prototypes/versions/${versionId}/render-error`, { message: message.message }).then((saved) => saved && router.refresh());
    } else if (message.type === "element-selected") {
      onElementSelected?.(message.element);
    }
  };

  return (
    <>
      <PrototypeFrame
        src={renderSrc(frameBase, state)}
        width={size.width}
        height={size.height}
        title={`${title} on ${device.label}`}
        label={`${device.label}${state.orientation === "landscape" && state.device !== "desktop" ? ", landscape" : ""} · ${size.width} × ${size.height}`}
        commentMode={commentMode}
        pins={pins}
        highlight={highlight}
        onFrameMessage={onMessage}
      />
      {needsAudit && report && <AuditRunner key={versionId} versionId={versionId} title={title} frameBase={frameBase} />}
    </>
  );
}

/**
 * Runs a version's accessibility audit once, in a frame at the desktop width
 * in light mode that the visitor doesn't see, and records the result. Pages
 * render it for a version that has no audit yet, whatever tab is shown.
 */
export function AuditRunner({ versionId, title, frameBase = `/prototypes/render/${versionId}` }: { versionId: string; title: string; frameBase?: string }) {
  const router = useRouter();
  const [auditing, setAuditing] = useState(true);
  if (!auditing) return null;
  return (
    <PrototypeFrame
      src={frameBase}
      width={DEVICES.desktop.width}
      height={DEVICES.desktop.height}
      title={`${title}, accessibility audit`}
      audit
      hidden
      onFrameMessage={(message) => {
        if (message.type !== "audit-result" && message.type !== "audit-error") return;
        setAuditing(false);
        if (message.type === "audit-result") void postJson(`/api/prototypes/versions/${versionId}/audit`, { violations: message.violations }).then((saved) => saved && router.refresh());
      }}
    />
  );
}
