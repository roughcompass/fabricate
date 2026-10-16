// Salt's theme and fonts, for generated Salt members and shells; they apply only inside a portal's root (design decision 11 of converge-templates-and-prototypes).
import "@salt-ds/theme/index.css";
import "@salt-ds/theme/css/theme-next.css";
import "@fontsource/open-sans/400.css";
import "@fontsource/open-sans/600.css";
import "@fontsource/open-sans/700.css";
import "@fontsource/pt-mono/400.css";
// The portal brand palettes, declared on each running application's root.
import "@/demo/runtime/tokens.css";

/**
 * Running demo applications render full-bleed inside their own portal shell,
 * without Fabricate's operator shell (see (operator)/layout.tsx).
 */
export default function RuntimeLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
