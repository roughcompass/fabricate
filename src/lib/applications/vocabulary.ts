/*
 * The fixed vocabularies of Applications, with the labels people read.
 * Forms and cards in the browser use them, so this module imports nothing.
 */

/**
 * How DE Web will render an Application, as its DE Web assessment
 * determined it (rendering-assessment spec), or Undetermined when the
 * Profile doesn't settle it.
 */
export const RENDERING_MODES = ["esm", "module_federation_2", "iframe", "undetermined"] as const;
export type RenderingMode = (typeof RENDERING_MODES)[number];

export const RENDERING_MODE_LABELS: Record<RenderingMode, string> = { esm: "ESM", module_federation_2: "Module Federation", iframe: "iframe", undetermined: "Undetermined" };
