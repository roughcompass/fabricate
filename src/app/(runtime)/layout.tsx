/**
 * Running applications render full-bleed, without the Frontend Registry's
 * operator shell (see (operator)/layout.tsx): the application's build in a
 * frame, with the toolbar above it.
 */
export default function RuntimeLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
