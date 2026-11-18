"use client";

import { useState } from "react";
import { DemoToolbar } from "@/components/toolbar/demo-toolbar";
import { AccessibilityPanel } from "../toolbar/accessibility/accessibility-panel";
import { AuditOverlay } from "../toolbar/accessibility/audit-overlay";
import { AuditProvider } from "../toolbar/accessibility/audit-state";
import { CommentLayer } from "../toolbar/comments/comment-layer";
import { CommentsPanel } from "../toolbar/comments/comments-panel";
import { CommentsProvider, useComments } from "../toolbar/comments/comments-state";
import { GuidedHints, HintsContext, RUNTIME_HINTS, useHintControls } from "../toolbar/guided-hints";
import { DebugLabels, SelectOverlay, ZoneIndicator } from "../toolbar/microfrontend-overlays";
import { MicrofrontendsPanel } from "../toolbar/microfrontends-panel";
import { SessionPanel } from "../toolbar/session-panel";
import { SettingsPanel } from "../toolbar/settings-panel";
import { SharePanel } from "../toolbar/share-panel";
import { HotSpotsOverlay } from "../toolbar/timing/hot-spots-overlay";
import { TimingPanel } from "../toolbar/timing/timing-panel";
import { TimingProvider } from "../toolbar/timing/timing-state";
import { useEmbedded, useRuntime } from "./runtime-context";
import { ENVIRONMENT_LABELS } from "./shell-parts";

/** The toolbar with the running application's tools, overlays, and guided hints; none while preview mode frames the application. */
export function RuntimeToolbar() {
  if (useEmbedded()) return null;
  return (
    <CommentsProvider>
      <AuditProvider>
        <TimingProvider>
          <Toolbar />
        </TimingProvider>
      </AuditProvider>
    </CommentsProvider>
  );
}

function Toolbar() {
  const { descriptor } = useRuntime();
  const [selectedMember, setSelectedMember] = useState<string | null>(null);
  const comments = useComments();
  const hints = useHintControls(descriptor.hints);
  return (
    <HintsContext value={hints}>
      <DemoToolbar
        context={{ name: descriptor.applicationName, environment: ENVIRONMENT_LABELS[descriptor.environment], href: descriptor.pageHref }}
        commentCount={comments.threads.filter((thread) => thread.status === "open").length}
        panels={{
          comments: <CommentsPanel />,
          microfrontends: <MicrofrontendsPanel selected={selectedMember} onSelect={setSelectedMember} />,
          accessibility: <AccessibilityPanel />,
          timing: <TimingPanel />,
          session: <SessionPanel />,
          settings: <SettingsPanel />,
          share: <SharePanel />,
        }}
        overlays={
          <>
            <HotSpotsOverlay />
            <AuditOverlay />
            <SelectOverlay onChoose={setSelectedMember} />
            <ZoneIndicator />
            <DebugLabels />
            <CommentLayer />
            <GuidedHints sequence="runtime" hints={RUNTIME_HINTS} controls={hints} />
          </>
        }
      />
    </HintsContext>
  );
}
