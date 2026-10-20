import {
  Avatar,
  Button,
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
  Drawer,
  FlowLayout,
  Link,
  SkipLink,
  StackLayout,
  Text,
  useCurrentBreakpoint,
  VerticalNavigation,
  VerticalNavigationItem,
  VerticalNavigationItemContent,
  VerticalNavigationItemExpansionIcon,
  VerticalNavigationItemLabel,
  VerticalNavigationItemTrigger,
  VerticalNavigationSubMenu,
} from "@salt-ds/core";
import { CloseIcon, MenuIcon } from "@salt-ds/icons";
import { type MouseEvent, type ReactNode, useState } from "react";
import "./page-shell.css";

/*
 * The common page shell every page prototype renders in (prototypes/page-shell
 * spec): Salt's App header pattern, with the persona as the signed-in user;
 * primary navigation following Salt's Vertical navigation pattern, which moves
 * into a Drawer behind a header button at Salt's small breakpoints; and a
 * footer composed from Salt's layout, Text, and Link, since Salt has no footer
 * pattern. It is built only from React and Salt, so this file is shown and
 * downloaded unchanged.
 */

export interface ShellNavItem {
  readonly label: string;
  readonly children: readonly string[];
}

export interface ShellConfig {
  readonly appName: string;
  readonly nav: readonly ShellNavItem[];
  readonly footerText: string;
  readonly footerLinks: readonly { readonly label: string; readonly href: string }[];
}

export interface PageShellProps {
  readonly config: ShellConfig;
  /** The navigation item the page belongs to, top-level or child; null marks none current. */
  readonly current: string | null;
  readonly user: { readonly name: string; readonly role: string };
  readonly children: ReactNode;
}

const MAIN_ID = "page-shell-main";

/** The shell's links lead nowhere: a prototype is one page. */
const stay = (event: MouseEvent) => event.preventDefault();

const anchor = (label: string) => `#${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

function Navigation({ items, current, onNavigate }: { items: readonly ShellNavItem[]; current: string | null; onNavigate: () => void }) {
  return (
    <VerticalNavigation aria-label="Main navigation" className="pageShell-navigation">
      {items.map((item) =>
        item.children.length > 0 ? (
          <VerticalNavigationItem key={item.label} active={current === item.label}>
            <Collapsible defaultOpen={item.children.includes(current ?? "")}>
              <VerticalNavigationItemContent>
                <CollapsibleTrigger>
                  <VerticalNavigationItemTrigger>
                    <VerticalNavigationItemLabel>{item.label}</VerticalNavigationItemLabel>
                    <VerticalNavigationItemExpansionIcon />
                  </VerticalNavigationItemTrigger>
                </CollapsibleTrigger>
              </VerticalNavigationItemContent>
              <CollapsiblePanel>
                <VerticalNavigationSubMenu>
                  {item.children.map((child) => (
                    <VerticalNavigationItem key={child} active={current === child}>
                      <VerticalNavigationItemContent>
                        <VerticalNavigationItemTrigger
                          render={<a href={anchor(child)} aria-current={current === child ? "page" : undefined} />}
                          onClick={(event) => {
                            stay(event);
                            onNavigate();
                          }}
                        >
                          <VerticalNavigationItemLabel>{child}</VerticalNavigationItemLabel>
                        </VerticalNavigationItemTrigger>
                      </VerticalNavigationItemContent>
                    </VerticalNavigationItem>
                  ))}
                </VerticalNavigationSubMenu>
              </CollapsiblePanel>
            </Collapsible>
          </VerticalNavigationItem>
        ) : (
          <VerticalNavigationItem key={item.label} active={current === item.label}>
            <VerticalNavigationItemContent>
              <VerticalNavigationItemTrigger
                render={<a href={anchor(item.label)} aria-current={current === item.label ? "page" : undefined} />}
                onClick={(event) => {
                  stay(event);
                  onNavigate();
                }}
              >
                <VerticalNavigationItemLabel>{item.label}</VerticalNavigationItemLabel>
              </VerticalNavigationItemTrigger>
            </VerticalNavigationItemContent>
          </VerticalNavigationItem>
        ),
      )}
    </VerticalNavigation>
  );
}

export function PageShell({ config, current, user, children }: PageShellProps) {
  const breakpoint = useCurrentBreakpoint();
  const small = breakpoint === "xs" || breakpoint === "sm";
  const [opened, setOpen] = useState(false);
  // The drawer exists only at small widths, so widening the viewport closes it.
  const open = small && opened;

  const navigation = <Navigation items={config.nav} current={current} onNavigate={() => setOpen(false)} />;

  return (
    <>
      {/* The first focusable element, outside the header so it isn't part of the banner landmark. */}
      <SkipLink targetId={MAIN_ID}>Skip to main content</SkipLink>
      <div className="pageShell">
        <header className="pageShell-header" data-small-viewport={small}>
          {small && (
            <Button appearance="transparent" aria-label={open ? "Close navigation" : "Open navigation"} aria-expanded={open} onClick={() => setOpen((value) => !value)}>
              {open ? <CloseIcon aria-hidden /> : <MenuIcon aria-hidden />}
            </Button>
          )}
          <Link href="#" onClick={stay} className="pageShell-appName" color="primary" underline="never">
            {/* The J.P. Morgan logo, from DE FabLab's own origin, in the variant that reads against the header's mode. */}
            <img src="/brand/jpmorgan-logo.svg" alt="J.P. Morgan" className="pageShell-logo pageShell-logo-light" />
            <img src="/brand/jpmorgan-logo-dark.svg" alt="J.P. Morgan" className="pageShell-logo pageShell-logo-dark" />
            <span className="pageShell-divider" aria-hidden="true" />
            <Text as="span" styleAs="h4">
              {config.appName}
            </Text>
          </Link>
          <StackLayout direction="row" align="center" gap={1} className="pageShell-user">
            <Avatar name={user.name} size={1} />
            {!small && (
              <StackLayout gap={0}>
                <Text styleAs="label">
                  <strong>{user.name}</strong>
                </Text>
                <Text styleAs="label" color="secondary">
                  {user.role}
                </Text>
              </StackLayout>
            )}
          </StackLayout>
        </header>
        <div className="pageShell-body">
          {!small && <aside className="pageShell-sidebar">{navigation}</aside>}
          <main id={MAIN_ID} className="pageShell-main" tabIndex={-1}>
            {children}
          </main>
        </div>
        <footer className="pageShell-footer">
          <StackLayout gap={1}>
            <Text styleAs="label" color="secondary">
              {config.footerText}
            </Text>
            {config.footerLinks.length > 0 && (
              <FlowLayout gap={2}>
                {config.footerLinks.map((link) => (
                  <Link key={link.label} href={link.href} onClick={stay}>
                    {link.label}
                  </Link>
                ))}
              </FlowLayout>
            )}
          </StackLayout>
        </footer>
      </div>
      {small && (
        <Drawer open={open} onOpenChange={setOpen} aria-label="Main navigation" className="pageShell-drawer">
          {navigation}
        </Drawer>
      )}
    </>
  );
}
