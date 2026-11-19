"use client";

import { usePathname } from "next/navigation";

/**
 * A focused page's shell header, from the layout's `header` slot. Next.js
 * keeps a slot's last page through client navigations to pages that have
 * none, so once the address leaves the focused page, the shell's own header
 * shows again.
 */
export function FocusedHeader({ path, focused, shell }: { path: string; focused: React.ReactNode; shell: React.ReactNode }) {
  return usePathname() === path ? focused : shell;
}
