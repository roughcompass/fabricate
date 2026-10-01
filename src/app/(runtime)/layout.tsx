// The portal brand palettes, declared on each running application's root.
import "@/demo/runtime/tokens.css";

/**
 * Running demo applications render full-bleed inside their own portal shell,
 * without Fabricate's operator shell (see (operator)/layout.tsx).
 */
export default function RuntimeLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
