// Inline SVG icons on a 24px grid, so status never relies on color alone.
const PATHS = {
  check: "M20 6 9 17l-5-5",
  checkCircle: "M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0zM8 12l3 3 5-6",
  x: "M18 6 6 18M6 6l12 12",
  xCircle: "M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0zM15 9l-6 6m0-6 6 6",
  clock: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0zM12 7v5l3 2",
  spinner: "M21 12a9 9 0 1 1-6.22-8.56",
  alert: "M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z",
  help: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0zM9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3m.1 4h.01",
  info: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0zM12 11v5m0-8h.01",
  minus: "M5 12h14",
  slash: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0zM5.6 5.6l12.8 12.8",
  eye: "M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zm13 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0z",
  sparkle: "M12 3v4m0 10v4M3 12h4m10 0h4M6.3 6.3l2.1 2.1m7.2 7.2 2.1 2.1m0-11.4-2.1 2.1m-7.2 7.2-2.1 2.1",
  layers: "m12 3 9 5-9 5-9-5 9-5zM3 13l9 5 9-5",
  plus: "M12 5v14M5 12h14",
  arrowLeft: "M19 12H5m6 6-6-6 6-6",
  arrowRight: "M5 12h14m-6-6 6 6-6 6",
  arrowUp: "M12 19V5m-6 6 6-6 6 6",
  arrowDown: "M12 5v14m6-6-6 6-6-6",
  folder: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z",
  play: "M7 4v16l13-8L7 4z",
  file: "M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6zm0 0v6h6",
  lock: "M6 11h12a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2zm2 0V7a4 4 0 0 1 8 0v4",
  edit: "M4 20h4L19 9l-4-4L4 16v4zm10-14 4 4",
  trash: "M4 7h16M10 11v6m4-6v6M6 7l1 13h10l1-13M9 7V4h6v3",
  network: "M12 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM5 21a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm14 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM12 7v4m0 0-5 6m5-6 5 6",
  cloud: "M7 18h10a4 4 0 0 0 .5-8A6 6 0 0 0 6 11a3.5 3.5 0 0 0 1 7z",
  git: "M6 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm0 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm12-6a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM6 8v8m2-10h4a4 4 0 0 1 4 4",
} as const;

export type IconName = keyof typeof PATHS;

interface IconProps {
  name: IconName;
  /** An accessible name. Without one the icon is decorative. */
  label?: string;
  size?: number;
  className?: string;
}

export function Icon({ name, label, size = 16, className }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      focusable="false"
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
