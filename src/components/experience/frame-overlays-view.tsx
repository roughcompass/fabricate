"use client";

import { EditorPanes } from "./editor-panes";
import { NothingSelected, usePreviewPane } from "./parts";

export function FrameOverlaysView() {
  const preview = usePreviewPane("all", "Hover or click an overlay to select");
  return <EditorPanes list={{ title: "Frame Overlays", children: null }} main={preview} options={{ title: "Options", children: <NothingSelected>Choose an overlay.</NothingSelected> }} />;
}
