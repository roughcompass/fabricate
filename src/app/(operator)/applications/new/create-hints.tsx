"use client";

import { CREATE_HINTS, GuidedHints, useHintControls } from "@/demo/toolbar/guided-hints";
import type { HintState } from "@/lib/demo/hints";

/** The create page's guided hints while the demo is enabled, the first sequence a self-serve visitor sees. */
export function CreateHints({ initial }: { initial: HintState }) {
  const controls = useHintControls(initial);
  return <GuidedHints sequence="create" hints={CREATE_HINTS} controls={controls} />;
}
