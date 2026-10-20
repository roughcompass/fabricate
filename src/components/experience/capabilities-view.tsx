"use client";

import { EditorPanes } from "./editor-panes";
import { usePreviewPane } from "./parts";

export function CapabilitiesView() {
  const preview = usePreviewPane();
  return <EditorPanes list={{ title: "Capability Toolkit", children: null }} main={preview} />;
}
