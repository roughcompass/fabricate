/** The Frontend Registry's mark: monochrome, in the color of the text around it. */
export function ProductMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 2 22 20H2L12 2z" fill="currentColor" />
    </svg>
  );
}
