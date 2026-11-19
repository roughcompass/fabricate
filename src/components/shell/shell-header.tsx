import { ButtonLink } from "@/components/ui/button";
import { buttonProps } from "@/components/ui/button-content";
import { Icon } from "@/components/ui/icon";
import { PRODUCT } from "@/lib/product";
import { BrandLink } from "./brand-link";
import { HOME } from "./navigation";
import { SidebarToggle } from "./sidebar-toggle";
import styles from "./shell-header.module.css";

/** The sidebar's element id: the header's controls open, show, and hide it. */
export const SIDEBAR_ID = "sidebar";

/** A focused page's back button: where it goes, and its name, "Back to" and the parent record's name. */
export interface ShellBack {
  readonly href: string;
  readonly label: string;
}

/**
 * The header to the right of the sidebar (operator-interface/page-patterns
 * spec, "The shell header holds navigation and global controls"): the page's
 * banner landmark, outside its main landmark. The application shell renders
 * it above every page, so it never holds a page's title or actions; the page
 * header does. Its start holds the control that shows a hidden sidebar or,
 * below 1024px, opens it as a drawer, and the product name beside it there.
 *
 * With `back`, the page is a focused page, as preview mode is: the header
 * holds a back button in place of the sidebar controls, and the shell hides
 * the sidebar while it is on the page (app-shell.module.css). Focused pages
 * supply it through the layout's `header` slot (src/app/(operator)/@header).
 */
export function ShellHeader({ back }: { back?: ShellBack }) {
  return (
    <header className={styles.header} data-shell-header={back ? "focused" : ""}>
      {back ? (
        <ButtonLink href={back.href} variant="tertiary" size="md" icon="arrowLeft" label={back.label} />
      ) : (
        <>
          <span className={styles.showSidebar} data-sidebar-control="">
            <SidebarToggle to="shown" />
          </span>
          {/* A native popover invoker, so the drawer opens without JavaScript. */}
          <span className={styles.openNavigation} data-sidebar-control="">
            <button type="button" popoverTarget={SIDEBAR_ID} {...buttonProps("tertiary", "md", true)} aria-label="Open navigation" title="Open navigation">
              <Icon name="menu" />
            </button>
          </span>
          <BrandLink href={HOME.href} className={styles.product}>
            {PRODUCT.name}
          </BrandLink>
        </>
      )}
    </header>
  );
}
