import { Fragment, useEffect, useId, useRef, useState, type ReactNode, type MouseEvent } from "react";
import {
  Avatar,
  Badge,
  Banner,
  BannerActions,
  BannerContent,
  Breadcrumb,
  Breadcrumbs,
  Button,
  Divider,
  Drawer,
  DrawerContent,
  DrawerHeader,
  Dropdown,
  FlexLayout,
  H1,
  Input,
  Kbd,
  Link,
  NavigationItem,
  Option,
  Overlay,
  OverlayPanel,
  OverlayPanelContent,
  OverlayTrigger,
  SkipLink,
  StackLayout,
  Text,
  Tooltip,
  useBreakpoint,
  useTheme,
} from "@salt-ds/core";
import {
  CallIcon,
  ChartLineIcon,
  ChevronDownIcon,
  CloseIcon,
  DocumentIcon,
  DoubleChevronLeftIcon,
  DoubleChevronRightIcon,
  FeedbackIcon,
  FolderClosedIcon,
  HelpCircleIcon,
  HomeIcon,
  MenuIcon,
  NotificationIcon,
  SearchIcon,
  SettingsIcon,
} from "@salt-ds/icons";
import {
  routeHref,
  useApplication,
  useExperience,
  useNavigate,
  useProfile,
  useRoute,
  type PortalMenuEntry,
  type PortalRoute,
} from "@deweb/portal";
import styles from "./access.module.css";

const WORKSPACES = ["Corporate Banking", "Treasury Services", "Commercial Banking"] as const;

/**
 * Below Salt's md breakpoint the menu becomes a drawer and the header compacts.
 * Until Salt has matched the viewport, as on the server, the shell lays out wide.
 */
function useCompact(): boolean {
  const { matchedBreakpoints } = useBreakpoint();
  return matchedBreakpoints.length > 0 && !matchedBreakpoints.includes("md");
}

/** Whether a keydown matches a shortcut such as "/", "k", or "ctrl+k". */
function matchesShortcut(event: KeyboardEvent, shortcut: string): boolean {
  const parts = shortcut.toLowerCase().split("+");
  const key = parts.pop();
  if (!key || event.key.toLowerCase() !== key) return false;
  return parts.includes("ctrl") === event.ctrlKey && parts.includes("meta") === event.metaKey && parts.includes("alt") === event.altKey;
}

type MenuEntry = { primary: string; secondary?: string };

/** A header action: an icon button, named by its tooltip while closed, that opens a panel of entries. */
function HeaderMenu({ label, icon, title, items }: { label: string; icon: ReactNode; title: string; items: MenuEntry[] }) {
  const [open, setOpen] = useState(false);
  return (
    <Overlay open={open} onOpenChange={setOpen} placement="bottom">
      <Tooltip content={label} placement="bottom" disabled={open}>
        <OverlayTrigger>
          <Button appearance="transparent" aria-label={label}>
            {icon}
          </Button>
        </OverlayTrigger>
      </Tooltip>
      <OverlayPanel aria-label={label}>
        <OverlayPanelContent>
          <StackLayout gap={1}>
            <Text styleAs="h4">{title}</Text>
            <StackLayout as="ul" gap={1} className={styles.list}>
              {items.map((item) => (
                <StackLayout as="li" key={item.primary} gap={0}>
                  <Text>{item.primary}</Text>
                  {item.secondary && (
                    <Text styleAs="label" color="secondary">
                      {item.secondary}
                    </Text>
                  )}
                </StackLayout>
              ))}
            </StackLayout>
          </StackLayout>
        </OverlayPanelContent>
      </OverlayPanel>
    </Overlay>
  );
}

function UserMenu({ compact }: { compact: boolean }) {
  const profile = useProfile();
  const label = `User menu for ${profile.name}`;
  const role = `${profile.persona} · ${profile.region}`;
  return (
    <FlexLayout align="center" data-demo-anchor="portal-session">
      <Overlay placement="bottom">
        <OverlayTrigger>
          <Button appearance="transparent" aria-label={label}>
            <Avatar name={profile.name} size={1} aria-hidden />
            {!compact && (
              <StackLayout gap={0} align="start">
                <Text>{profile.name}</Text>
                <Text styleAs="label" color="secondary">
                  {role}
                </Text>
              </StackLayout>
            )}
            <ChevronDownIcon aria-hidden />
          </Button>
        </OverlayTrigger>
        <OverlayPanel aria-label={label}>
          <OverlayPanelContent>
            <StackLayout gap={1}>
              <Text styleAs="h4">{profile.name}</Text>
              <Text styleAs="label" color="secondary">
                {role}
              </Text>
              <Text>The profile comes from the session context. Change it in the toolbar&apos;s Session tool.</Text>
            </StackLayout>
          </OverlayPanelContent>
        </OverlayPanel>
      </Overlay>
    </FlexLayout>
  );
}

/** The header's search field, the Global Search toolkit's control: a field on wide screens, a button that opens one on narrow ones. Its shortcut focuses it. */
function GlobalSearch({ placeholder, shortcut, compact, portal }: { placeholder: string; shortcut: string; compact: boolean; portal: string }) {
  const field = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) return;
      if (!matchesShortcut(event, shortcut)) return;
      event.preventDefault();
      field.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shortcut]);
  const input = (
    <Input
      placeholder={placeholder}
      startAdornment={<SearchIcon aria-hidden />}
      endAdornment={compact ? undefined : <Kbd aria-hidden>{shortcut}</Kbd>}
      inputRef={field}
      inputProps={{ "aria-label": "Search", "aria-keyshortcuts": shortcut }}
      className={compact ? undefined : styles.search}
    />
  );
  if (!compact) return input;
  return (
    <Overlay open={open} onOpenChange={setOpen} placement="bottom">
      <Tooltip content="Search" placement="bottom" disabled={open}>
        <OverlayTrigger>
          <Button appearance="transparent" aria-label="Search">
            <SearchIcon aria-hidden />
          </Button>
        </OverlayTrigger>
      </Tooltip>
      <OverlayPanel aria-label={`Search ${portal}`}>
        <OverlayPanelContent>
          <StackLayout gap={0} className={styles.searchPanel}>
            {input}
          </StackLayout>
        </OverlayPanelContent>
      </OverlayPanel>
    </Overlay>
  );
}

/** A menu group: a parent navigation item that expands to the entries it holds. */
function NavGroup({
  icon,
  label,
  level = 0,
  defaultOpen = false,
  containsCurrent = false,
  children,
}: {
  icon?: ReactNode;
  label: string;
  level?: number;
  defaultOpen?: boolean;
  containsCurrent?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <StackLayout as="li" gap="var(--salt-spacing-fixed-100)">
      <NavigationItem orientation="vertical" parent level={level} expanded={open} blurActive={containsCurrent && !open} onExpand={() => setOpen((value) => !value)}>
        {icon}
        {label}
      </NavigationItem>
      {open && (
        <StackLayout as="ul" gap="var(--salt-spacing-fixed-100)" className={styles.list}>
          {children}
        </StackLayout>
      )}
    </StackLayout>
  );
}

/** An entry of the menu with nowhere to go in the demo, its text aligned with a navigation item's at its level. */
function StaticEntry({ level = 1, children }: { level?: number; children: ReactNode }) {
  return (
    <FlexLayout as="li" gap={0}>
      <Text color="secondary" className={level > 1 ? styles.staticEntryNested : styles.staticEntry}>
        {children}
      </Text>
    </FlexLayout>
  );
}

export default function Shell({ children }: { children: ReactNode }) {
  const { current: currentRoute, routes } = useRoute();
  const navigate = useNavigate();
  const { name: applicationName, environment } = useApplication();
  const experience = useExperience();
  const { mode } = useTheme();
  const compact = useCompact();
  const [hidden, setHidden] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const navId = useId();
  const mainId = useId();

  const { portalName, logo, sidebar, footer, banner, headerSlots } = experience;
  const portalTitle = `${logo.alt} ${portalName}`;
  const navigationLabel = `${portalTitle} navigation`;
  const start = routes[0];
  const current = currentRoute ?? start;
  const inDrawer = compact || sidebar.menuType === "flyout";
  const expanded = inDrawer ? drawer : !hidden;

  useEffect(() => {
    if (!compact) setDrawer(false);
  }, [compact]);

  const go = (event: MouseEvent, route: PortalRoute | undefined) => {
    event.preventDefault();
    setDrawer(false);
    if (route) navigate(route);
  };

  /** The application's route an item of the Portal's menu points at, if it's one of this application's. */
  const routeOf = (entry: PortalMenuEntry) => routes.find((route) => entry.route !== null && `/${route.path}` === entry.route.replace(/\/+$/, ""));

  const portalEntries = (parentId: string | null, level: number): ReactNode =>
    experience.menu
      .filter((entry) => entry.parentId === parentId)
      .map((entry) => {
        if (entry.kind === "group") {
          return (
            <NavGroup key={entry.id} icon={level === 0 ? <FolderClosedIcon aria-hidden /> : undefined} label={entry.label} level={level}>
              {portalEntries(entry.id, level + 1)}
            </NavGroup>
          );
        }
        const route = routeOf(entry);
        if (!route) {
          return (
            <StaticEntry key={entry.id} level={level}>
              {entry.label}
            </StaticEntry>
          );
        }
        return (
          <FlexLayout as="li" key={entry.id} gap={0}>
            <NavigationItem orientation="vertical" level={level} href={routeHref(route)} active={route.path === current?.path} onClick={(event: MouseEvent) => go(event, route)}>
              {level === 0 && <DocumentIcon aria-hidden />}
              {entry.label}
            </NavigationItem>
          </FlexLayout>
        );
      });

  /** The menu: Home, the application's routes, then the Portal's menu, or the default groups without one. */
  const menuItems = (
    <StackLayout as="ul" gap="var(--salt-spacing-fixed-100)" className={styles.list}>
      <FlexLayout as="li" gap={0}>
        <NavigationItem orientation="vertical" href={start ? routeHref(start) : undefined} onClick={(event: MouseEvent) => go(event, start)}>
          <HomeIcon aria-hidden />
          Home
        </NavigationItem>
      </FlexLayout>
      <NavGroup icon={<FolderClosedIcon aria-hidden />} label={applicationName} defaultOpen containsCurrent>
        {routes.map((route) => (
          <FlexLayout as="li" key={route.path} gap={0}>
            <NavigationItem
              orientation="vertical"
              level={1}
              href={routeHref(route)}
              active={route.path === current?.path}
              data-demo-anchor={`nav-${route.path}`}
              onClick={(event: MouseEvent) => go(event, route)}
            >
              {route.label}
            </NavigationItem>
          </FlexLayout>
        ))}
      </NavGroup>
      {experience.menu.length > 0 ? (
        portalEntries(null, 0)
      ) : (
        <>
          <NavGroup icon={<ChartLineIcon aria-hidden />} label="Reports and Insights">
            <StaticEntry>Statements</StaticEntry>
            <StaticEntry>Analytics</StaticEntry>
          </NavGroup>
          <NavGroup icon={<CallIcon aria-hidden />} label="Support Hub">
            <StaticEntry>Guides</StaticEntry>
            <StaticEntry>Contact us</StaticEntry>
          </NavGroup>
        </>
      )}
    </StackLayout>
  );

  /** One of the sidebar's slots, in the experience's order: the workspace switcher, the menu, then Settings and Collapse. */
  const sidebarSlot = (slot: string): ReactNode => {
    if (slot === "top") {
      return (
        <Dropdown key="top" aria-label="Workspace" defaultSelected={[WORKSPACES[0]]} bordered>
          {WORKSPACES.map((workspace) => (
            <Option key={workspace} value={workspace} />
          ))}
        </Dropdown>
      );
    }
    if (slot === "main") return <Fragment key="main">{menuItems}</Fragment>;
    return (
      <StackLayout key="bottom" gap={1}>
        <Divider />
        <StackLayout gap={0.5} align="start">
          <Overlay placement="right">
            <OverlayTrigger>
              <Button appearance="transparent">
                <SettingsIcon aria-hidden />
                Settings
              </Button>
            </OverlayTrigger>
            <OverlayPanel aria-label="Settings">
              <OverlayPanelContent>
                <StackLayout gap={1}>
                  <Text styleAs="h4">Settings</Text>
                  <Text>Portal settings aren&apos;t part of the demo.</Text>
                </StackLayout>
              </OverlayPanelContent>
            </OverlayPanel>
          </Overlay>
          {!inDrawer && (
            <Button appearance="transparent" onClick={() => setCollapsed(true)}>
              <DoubleChevronLeftIcon aria-hidden />
              Collapse
            </Button>
          )}
        </StackLayout>
      </StackLayout>
    );
  };

  /** The full menu, in the column beside the content, where it stays in view, or in the drawer. */
  const navigation = (inColumn: boolean) => (
    <StackLayout as="nav" id={navId} aria-label={navigationLabel} gap={2} padding={inColumn ? 2 : 0} className={inColumn ? styles.sticky : undefined}>
      {sidebar.slots.map(sidebarSlot)}
    </StackLayout>
  );

  /** The collapsed menu: one icon per top-level entry, each named by its tooltip, then Expand. */
  const railButton = (key: string, label: string, icon: ReactNode, onClick: (event: MouseEvent) => void) => (
    <Tooltip key={key} content={label} placement="right">
      <Button appearance="transparent" aria-label={label} onClick={onClick}>
        {icon}
      </Button>
    </Tooltip>
  );
  const rail = (
    <StackLayout as="nav" id={navId} aria-label={navigationLabel} gap={1} padding={1} className={styles.sticky}>
      {railButton("home", "Home", <HomeIcon aria-hidden />, (event) => go(event, start))}
      {railButton("application", applicationName, <FolderClosedIcon aria-hidden />, () => setCollapsed(false))}
      {experience.menu
        .filter((entry) => entry.parentId === null)
        .map((entry) => railButton(entry.id, entry.label, entry.kind === "group" ? <FolderClosedIcon aria-hidden /> : <DocumentIcon aria-hidden />, () => setCollapsed(false)))}
      <Divider />
      {railButton("expand", "Expand menu", <DoubleChevronRightIcon aria-hidden />, () => setCollapsed(false))}
    </StackLayout>
  );

  // On compact screens the logo stands alone, and the link home still names the portal.
  const brand = (
    <>
      <img src={mode === "dark" ? logo.dark : logo.light} alt={logo.alt} width={132} height={28} className={styles.logo} />
      {!compact && <Divider orientation="vertical" aria-hidden />}
      {!compact && (
        <Text styleAs="h3" color="secondary">
          {portalName}
        </Text>
      )}
    </>
  );

  const headerSlot = (slot: string): ReactNode => {
    switch (slot) {
      case "toggle": {
        if (!sidebar.shown) return null;
        const label = expanded ? "Hide navigation" : "Show navigation";
        return (
          <Tooltip key="toggle" content={label} placement="bottom" disabled={inDrawer && drawer}>
            <Button
              appearance="transparent"
              aria-label={label}
              aria-expanded={expanded}
              aria-controls={navId}
              onClick={() => (inDrawer ? setDrawer((value) => !value) : setHidden((value) => !value))}
            >
              <MenuIcon aria-hidden />
            </Button>
          </Tooltip>
        );
      }
      case "brand":
        return experience.logoLinksHome ? (
          <Link key="brand" href={start ? routeHref(start) : undefined} onClick={(event: MouseEvent) => go(event, start)} underline="never" aria-label={compact ? portalTitle : undefined} className={styles.brand}>
            {brand}
          </Link>
        ) : (
          <FlexLayout key="brand" align="center" gap={1}>
            {brand}
          </FlexLayout>
        );
      case "global-search":
        return experience.search ? <GlobalSearch key="search" {...experience.search} compact={compact} portal={portalName} /> : null;
      case "notifications":
        return experience.notifications ? (
          <HeaderMenu
            key="notifications"
            label="Notifications"
            icon={
              experience.notifications.showUnread ? (
                <Badge value={2}>
                  <NotificationIcon aria-hidden />
                </Badge>
              ) : (
                <NotificationIcon aria-hidden />
              )
            }
            title={experience.notifications.title}
            items={[
              { primary: "Two payments need approval", secondary: "Today, 9:40" },
              { primary: "September statements are ready", secondary: "Yesterday" },
            ]}
          />
        ) : null;
      case "actions":
        return (
          <HeaderMenu
            key="help"
            label="Help"
            icon={<HelpCircleIcon aria-hidden />}
            title="Help"
            items={[
              { primary: "Support Hub", secondary: "Guides and contacts" },
              { primary: "Keyboard shortcuts", secondary: "Press ? with the toolbar open" },
            ]}
          />
        );
      case "feedback":
        return (
          <HeaderMenu
            key="feedback"
            label="Feedback"
            icon={<FeedbackIcon aria-hidden />}
            title="Feedback"
            items={[{ primary: `Tell us about ${portalName}`, secondary: "Feedback isn't sent anywhere in the demo." }]}
          />
        );
      case "user-menu":
        return <UserMenu key="user" compact={compact} />;
      default:
        return null;
    }
  };

  // The slots after the brand sit at the header's right end, in the experience's order.
  const brandAt = headerSlots.indexOf("brand");
  const leading = headerSlots.slice(0, brandAt + 1);
  const trailing = headerSlots.slice(brandAt + 1);

  const footerSlot = (slot: string): ReactNode => {
    if (slot === "primary") {
      return (
        <Text key="primary" styleAs="label" color="secondary">
          {footer.copyright}
        </Text>
      );
    }
    if (slot === "secondary") {
      return (
        <Text key="secondary" styleAs="label" color="secondary">
          {`An illustrative ${portalName} shell for the template demo. All data is fictional.`}
        </Text>
      );
    }
    return environment ? (
      <Text key="tertiary" styleAs="label" color="secondary">
        {`Environment: ${environment}`}
      </Text>
    ) : null;
  };

  return (
    <StackLayout gap={0} className={styles.shell}>
      <SkipLink targetId={mainId}>Skip to main content</SkipLink>
      {banner && !dismissed && (
        <Banner status={banner.severity} data-demo-anchor="portal-banner">
          <BannerContent>
            <FlexLayout gap={1} wrap align="baseline">
              <Text fontWeight="bolder">{banner.title}</Text>
              {banner.description && (
                <>
                  {" "}
                  <Text>{banner.description}</Text>
                </>
              )}
            </FlexLayout>
          </BannerContent>
          {banner.dismissible && (
            <BannerActions>
              <Button appearance="transparent" aria-label="Dismiss message" onClick={() => setDismissed(true)}>
                <CloseIcon aria-hidden />
              </Button>
            </BannerActions>
          )}
        </Banner>
      )}
      {headerSlots.length > 0 && (
        <FlexLayout as="header" data-demo-anchor="portal-header" align="center" justify="space-between" gap={2} wrap padding={1} className={styles.header}>
          <FlexLayout align="center" gap={1}>
            {leading.map(headerSlot)}
          </FlexLayout>
          <FlexLayout align="center" gap={1}>
            {trailing.map(headerSlot)}
          </FlexLayout>
        </FlexLayout>
      )}

      <FlexLayout gap={0} align="stretch" className={styles.body}>
        {sidebar.shown && !inDrawer && !hidden && (
          <StackLayout gap={0} data-demo-anchor="portal-menu" className={collapsed ? styles.rail : styles.sidebar}>
            {collapsed ? rail : navigation(true)}
          </StackLayout>
        )}
        {sidebar.shown && inDrawer && (
          // The drawer opens on the menu's first control, after its close button.
          <Drawer open={drawer} onOpenChange={setDrawer} position="left" initialFocus={1} className={styles.drawer}>
            <DrawerHeader
              header={portalName}
              actions={
                <Button appearance="transparent" aria-label="Close navigation" onClick={() => setDrawer(false)}>
                  <CloseIcon aria-hidden />
                </Button>
              }
            />
            <DrawerContent>{navigation(false)}</DrawerContent>
          </Drawer>
        )}

        <StackLayout gap={0} className={styles.content}>
          <StackLayout as="main" id={mainId} tabIndex={-1} gap={2} padding={{ xs: 2, md: 3 }} className={styles.main}>
            <Breadcrumbs aria-label="Breadcrumb" wrap>
              {/* The portal has no page of its own in the demo, so its crumb is text, not a link. */}
              <Breadcrumb>{portalName}</Breadcrumb>
              <Breadcrumb href={start ? routeHref(start) : undefined} onClick={(event: MouseEvent) => go(event, start)}>
                {applicationName}
              </Breadcrumb>
              <Breadcrumb aria-current="page">{current?.label}</Breadcrumb>
            </Breadcrumbs>
            <H1>{current?.label}</H1>
            {children}
          </StackLayout>
          {footer.shown && footer.slots.length > 0 && (
            <FlexLayout as="footer" data-demo-anchor="portal-footer" justify="space-between" wrap gap={2} padding={2} className={styles.footer}>
              {footer.slots.map(footerSlot)}
            </FlexLayout>
          )}
        </StackLayout>
      </FlexLayout>
    </StackLayout>
  );
}
