"use client";

import Link from "next/link";
import { closeDrawer } from "./sidebar-nav";

/**
 * The product mark's link to Home. Choosing it closes the sidebar's drawer,
 * as choosing a navigation item does, including when Home is already open
 * and the address doesn't change.
 */
export function BrandLink({ onClick, ...props }: React.ComponentProps<typeof Link>) {
  return (
    <Link
      {...props}
      onClick={(event) => {
        onClick?.(event);
        closeDrawer();
      }}
    />
  );
}
