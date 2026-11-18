import { useEffect, useId, useRef, useState, type ReactNode, type MouseEvent } from "react";
import {
  Avatar,
  Badge,
  Banner,
  BannerActions,
  BannerContent,
  Button,
  Divider,
  Drawer,
  DrawerContent,
  Dropdown,
  FlexLayout,
  H1,
  Input,
  Link,
  NavigationItem,
  Option,
  Overlay,
  OverlayPanel,
  OverlayPanelContent,
  OverlayTrigger,
  StackLayout,
  Text,
  useTheme,
} from "@salt-ds/core";
import {
  ChevronDownIcon,
  ChevronRightIcon,
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
  ChartLineIcon,
  CallIcon,
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

const NARROW = "(max-width: 767px)";
const WORKSPACES = ["Corporate Banking", "Treasury Services", "Commercial Banking"] as const;

function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const query = window.matchMedia(NARROW);
    const update = () => setNarrow(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return narrow;
}

/** Whether a keydown matches a shortcut such as "/", "k", or "ctrl+k". */
function matchesShortcut(event: KeyboardEvent, shortcut: string): boolean {
  const parts = shortcut.toLowerCase().split("+");
  const key = parts.pop();
  if (!key || event.key.toLowerCase() !== key) return false;
  return parts.includes("ctrl") === event.ctrlKey && parts.includes("meta") === event.metaKey && parts.includes("alt") === event.altKey;
}

type MenuEntry = { primary: string; secondary?: string };

function HeaderMenu({ label, icon, title, items, placement = "bottom" }: { label: string; icon: ReactNode; title: string; items: MenuEntry[]; placement?: "bottom" | "right" }) {
  return (
    <Overlay placement={placement}>
      <OverlayTrigger>
        <Button appearance="transparent" aria-label={label} title={label}>
          {icon}
        </Button>
      </OverlayTrigger>
      <OverlayPanel aria-label={label}>
        <OverlayPanelContent>
          <StackLayout gap={1}>
            <Text styleAs="h4">{title}</Text>
            <StackLayout as="ul" gap={1} style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {items.map((item) => (
                <li key={item.primary}>
                  <StackLayout gap={0}>
                    <Text>{item.primary}</Text>
                    {item.secondary && (
                      <Text styleAs="label" color="secondary">
                        {item.secondary}
                      </Text>
                    )}
                  </StackLayout>
                </li>
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
  return (
    <div data-demo-anchor="portal-session">
      <Overlay placement="bottom">
        <OverlayTrigger>
          {/* Named by its visible text after "User menu for", so the name contains what it shows (WCAG 2.5.3). */}
          <Button appearance="transparent">
            <span className="visually-hidden">{compact ? label : "User menu for"}</span>
            <Avatar name={profile.name} size={1} aria-hidden />
            {!compact && (
              <StackLayout gap={0} align="start">
                <Text>{profile.name}</Text>
                <Text styleAs="label" color="secondary">{`${profile.persona} · ${profile.region}`}</Text>
              </StackLayout>
            )}
            <ChevronDownIcon aria-hidden />
          </Button>
        </OverlayTrigger>
        <OverlayPanel aria-label={label}>
          <OverlayPanelContent>
            <StackLayout gap={1}>
              <Text styleAs="h4">{profile.name}</Text>
              <Text styleAs="label" color="secondary">{`${profile.persona} · ${profile.region}`}</Text>
              <Text>The profile comes from the session context. Change it in the toolbar&apos;s Session tool.</Text>
            </StackLayout>
          </OverlayPanelContent>
        </OverlayPanel>
      </Overlay>
    </div>
  );
}

/** The header's search field, the Global Search toolkit's control: a field on wide screens, a button that opens one on narrow ones. */
function GlobalSearch({ placeholder, shortcut, compact, portal }: { placeholder: string; shortcut: string; compact: boolean; portal: string }) {
  const field = useRef<HTMLInputElement>(null);
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
      inputRef={field}
      inputProps={{ "aria-label": "Search", "aria-keyshortcuts": shortcut }}
      style={{ width: "calc(var(--salt-size-base) * 9)" }}
    />
  );
  if (!compact) return input;
  return (
    <Overlay placement="bottom">
      <OverlayTrigger>
        <Button appearance="transparent" aria-label="Search" title="Search">
          <SearchIcon aria-hidden />
        </Button>
      </OverlayTrigger>
      <OverlayPanel aria-label={`Search ${portal}`}>
        <OverlayPanelContent>{input}</OverlayPanelContent>
      </OverlayPanel>
    </Overlay>
  );
}

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
    <li>
      <NavigationItem
        orientation="vertical"
        parent
        level={level}
        expanded={open}
        blurActive={containsCurrent && !open}
        onExpand={() => setOpen((value) => !value)}
      >
        {icon}
        {label}
      </NavigationItem>
      {open && (
        <StackLayout as="ul" gap="var(--salt-spacing-fixed-100)" style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {children}
        </StackLayout>
      )}
    </li>
  );
}

/** An entry of the menu with nowhere to go in the demo, indented like an item at its level. */
function StaticEntry({ level = 1, children }: { level?: number; children: ReactNode }) {
  const text = <Text color="secondary">{children}</Text>;
  return (
    <li
      style={{
        paddingTop: "var(--salt-spacing-100)",
        paddingBottom: "var(--salt-spacing-100)",
        paddingLeft: "calc(var(--salt-spacing-300) * 2)",
      }}
    >
      {level > 1 ? <div style={{ paddingLeft: "var(--salt-spacing-300)" }}>{text}</div> : text}
    </li>
  );
}

export default function Shell({ children }: { children: ReactNode }) {
  const { current: currentRoute, routes } = useRoute();
  const navigate = useNavigate();
  const { name: applicationName, environment } = useApplication();
  const experience = useExperience();
  const { mode } = useTheme();
  const narrow = useNarrow();
  const [hidden, setHidden] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const navId = useId();

  const { portalName, logo, sidebar, footer, banner, headerSlots } = experience;
  const portalTitle = `${logo.alt} ${portalName}`;
  const start = routes[0];
  const current = currentRoute ?? start;
  const flyout = sidebar.menuType === "flyout";
  const inDrawer = narrow || flyout;
  const expanded = inDrawer ? drawer : !hidden;

  useEffect(() => {
    if (!narrow) setDrawer(false);
  }, [narrow]);

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
          <li key={entry.id}>
            <NavigationItem orientation="vertical" level={level} href={routeHref(route)} active={route.path === current?.path} onClick={(event: MouseEvent) => go(event, route)}>
              {level === 0 && <DocumentIcon aria-hidden />}
              {entry.label}
            </NavigationItem>
          </li>
        );
      });

  const menuItems = (
    <StackLayout as="ul" gap="var(--salt-spacing-fixed-100)" style={{ listStyle: "none", margin: 0, padding: 0 }}>
      <li>
        <NavigationItem orientation="vertical" href={start ? routeHref(start) : undefined} onClick={(event: MouseEvent) => go(event, start)}>
          <HomeIcon aria-hidden />
          Home
        </NavigationItem>
      </li>
      <NavGroup icon={<FolderClosedIcon aria-hidden />} label={applicationName} defaultOpen containsCurrent>
        {routes.map((route) => (
          <li key={route.path}>
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
          </li>
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

  const sidebarSlot = (slot: string, inRail: boolean): ReactNode => {
    if (slot === "top") {
      return (
        <StackLayout key="top" gap={0}>
          <Dropdown aria-label="Workspace" defaultSelected={[WORKSPACES[0]]} bordered>
            {WORKSPACES.map((workspace) => (
              <Option key={workspace} value={workspace} />
            ))}
          </Dropdown>
        </StackLayout>
      );
    }
    if (slot === "main") {
      return (
        <div key="main">{menuItems}</div>
      );
    }
    return (
      <StackLayout key="bottom" gap={0.5}>
        <Divider />
        <Overlay placement="right">
          <OverlayTrigger>
            <Button appearance="transparent" style={{ justifyContent: "flex-start" }}>
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
        {!inRail && !inDrawer && (
          <Button appearance="transparent" style={{ justifyContent: "flex-start" }} onClick={() => setCollapsed(true)}>
            <DoubleChevronLeftIcon aria-hidden />
            Collapse
          </Button>
        )}
      </StackLayout>
    );
  };

  const navigation = (
    <nav id={navId} aria-label={`${portalTitle} navigation`} style={{ position: "sticky", top: 0 }}>
      <StackLayout gap={2}>
        {sidebar.slots.map((slot) => sidebarSlot(slot, false))}
      </StackLayout>
    </nav>
  );

  /** The collapsed menu: one icon per top-level entry, then Settings and Expand. */
  const rail = (
    <nav id={navId} aria-label={`${portalTitle} navigation`} style={{ position: "sticky", top: 0 }}>
      <StackLayout gap={1} align="center">
        <Button appearance="transparent" aria-label="Home" title="Home" onClick={(event: MouseEvent) => go(event, start)}>
          <HomeIcon aria-hidden />
        </Button>
        <Button appearance="transparent" aria-label={applicationName} title={applicationName} onClick={() => setCollapsed(false)}>
          <FolderClosedIcon aria-hidden />
        </Button>
        {experience.menu
          .filter((entry) => entry.parentId === null)
          .map((entry) => (
            <Button key={entry.id} appearance="transparent" aria-label={entry.label} title={entry.label} onClick={() => setCollapsed(false)}>
              {entry.kind === "group" ? <FolderClosedIcon aria-hidden /> : <DocumentIcon aria-hidden />}
            </Button>
          ))}
        <Divider />
        <Button appearance="transparent" aria-label="Expand menu" title="Expand menu" onClick={() => setCollapsed(false)}>
          <DoubleChevronRightIcon aria-hidden />
        </Button>
      </StackLayout>
    </nav>
  );

  const brand = (
    <FlexLayout as="span" align="center" gap={1}>
      <img src={mode === "dark" ? logo.dark : logo.light} alt={logo.alt} style={{ display: "block", height: "calc(var(--salt-size-base) * 0.8)", width: "auto" }} />
      {!narrow && <Divider orientation="vertical" aria-hidden />}
      {!narrow && (
        <Text as="span" styleAs="h3" color="secondary">
          {portalName}
        </Text>
      )}
    </FlexLayout>
  );

  const headerSlot = (slot: string): ReactNode => {
    switch (slot) {
      case "toggle":
        return sidebar.shown ? (
          <Button
            key="toggle"
            appearance="transparent"
            aria-label={expanded ? "Hide navigation" : "Show navigation"}
            title={expanded ? "Hide navigation" : "Show navigation"}
            aria-expanded={expanded}
            aria-controls={navId}
            onClick={() => (inDrawer ? setDrawer((value) => !value) : setHidden((value) => !value))}
          >
            <MenuIcon aria-hidden />
          </Button>
        ) : null;
      case "brand":
        return experience.logoLinksHome ? (
          // On narrow screens the logo stands alone, and the link still names the portal.
          <Link key="brand" href={start ? routeHref(start) : undefined} onClick={(event: MouseEvent) => go(event, start)} underline="never" aria-label={narrow ? portalTitle : undefined}>
            {brand}
          </Link>
        ) : (
          <span key="brand" aria-label={narrow ? portalTitle : undefined}>
            {brand}
          </span>
        );
      case "global-search":
        return experience.search ? <GlobalSearch key="search" {...experience.search} compact={narrow} portal={portalName} /> : null;
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
        return <UserMenu key="user" compact={narrow} />;
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
    <StackLayout gap={0} style={{ background: "var(--salt-container-primary-background)" }}>
      {banner && !dismissed && (
        <Banner status={banner.severity} data-demo-anchor="portal-banner">
          <BannerContent>
            <Text>
              <strong>{banner.title}</strong>
              {banner.description ? ` ${banner.description}` : ""}
            </Text>
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
        <FlexLayout
          as="header"
          data-demo-anchor="portal-header"
          align="center"
          justify="space-between"
          gap={2}
          padding={1}
          style={{
            borderBottomWidth: "var(--salt-size-border)",
            borderBottomStyle: "solid",
            borderBottomColor: "var(--salt-separable-tertiary-borderColor)",
            background: "var(--salt-container-primary-background)",
          }}
        >
          <FlexLayout align="center" gap={1}>
            {leading.map(headerSlot)}
          </FlexLayout>
          <FlexLayout align="center" gap={1}>
            {trailing.map(headerSlot)}
          </FlexLayout>
        </FlexLayout>
      )}

      <FlexLayout gap={0} align="stretch" style={{ flex: 1 }}>
        {sidebar.shown && !inDrawer && !hidden && collapsed && (
          <div
            data-demo-anchor="portal-menu"
            style={{
              display: "flex",
              flexDirection: "column",
              flexShrink: 0,
              width: "calc(var(--salt-size-base) * 2)",
              paddingTop: "var(--salt-spacing-200)",
              paddingBottom: "var(--salt-spacing-200)",
              paddingLeft: "var(--salt-spacing-100)",
              paddingRight: "var(--salt-spacing-100)",
              borderRightWidth: "var(--salt-size-border)",
              borderRightStyle: "solid",
              borderRightColor: "var(--salt-separable-tertiary-borderColor)",
              background: "var(--salt-container-primary-background)",
            }}
          >
            {rail}
          </div>
        )}
        {sidebar.shown && !inDrawer && !hidden && !collapsed && (
          <div
            data-demo-anchor="portal-menu"
            style={{
              display: "flex",
              flexDirection: "column",
              flexShrink: 0,
              width: "calc(var(--salt-size-base) * 8)",
              padding: "var(--salt-spacing-200)",
              borderRightWidth: "var(--salt-size-border)",
              borderRightStyle: "solid",
              borderRightColor: "var(--salt-separable-tertiary-borderColor)",
              background: "var(--salt-container-primary-background)",
            }}
          >
            {navigation}
          </div>
        )}
        {sidebar.shown && inDrawer && (
          <Drawer open={drawer} onOpenChange={setDrawer} position="left" aria-label={`${portalTitle} navigation`} style={{ width: "calc(var(--salt-size-base) * 9)" }}>
            <DrawerContent>{navigation}</DrawerContent>
          </Drawer>
        )}

        <StackLayout gap={0} style={{ flex: 1, minWidth: 0 }}>
          <StackLayout as="main" gap={2} padding={3} style={{ flex: 1 }}>
            <nav aria-label="Breadcrumb">
              <FlexLayout as="ol" align="center" gap={1} wrap style={{ listStyle: "none", margin: 0, padding: 0 }}>
                <FlexLayout as="li" align="center" gap={1}>
                  <Text color="secondary">{portalName}</Text>
                  <ChevronRightIcon aria-hidden />
                </FlexLayout>
                <FlexLayout as="li" align="center" gap={1}>
                  <Link href={start ? routeHref(start) : undefined} onClick={(event: MouseEvent) => go(event, start)}>
                    {applicationName}
                  </Link>
                  <ChevronRightIcon aria-hidden />
                </FlexLayout>
                <li aria-current="page">
                  <Text>{current?.label}</Text>
                </li>
              </FlexLayout>
            </nav>
            <H1>{current?.label}</H1>
            {children}
          </StackLayout>
          {footer.shown && footer.slots.length > 0 && (
            <FlexLayout
              as="footer"
              data-demo-anchor="portal-footer"
              justify="space-between"
              wrap
              gap={2}
              padding={2}
              style={{
                borderTopWidth: "var(--salt-size-border)",
                borderTopStyle: "solid",
                borderTopColor: "var(--salt-separable-tertiary-borderColor)",
              }}
            >
              {footer.slots.map(footerSlot)}
            </FlexLayout>
          )}
        </StackLayout>
      </FlexLayout>
    </StackLayout>
  );
}
