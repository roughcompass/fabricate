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
  FlexLayout,
  Input,
  Link,
  Menu,
  MenuItem,
  MenuPanel,
  MenuTrigger,
  NavigationItem,
  StackLayout,
  Text,
  useTheme,
} from "@salt-ds/core";
import {
  ChevronDownIcon,
  CloseIcon,
  DocumentIcon,
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

/** Sections of the portal beside the application; only the application itself is part of the demo. */
const SECTIONS = ["Home", "Research", "Data & Analytics"] as const;
const FOOTER_LINKS = [
  "Terms of Use",
  "Disclosures",
  "Security",
  "Privacy",
  "Cookies Policy",
  "Contact Us",
] as const;

/** Whether a keydown matches a shortcut such as "/", "k", or "ctrl+k". */
function matchesShortcut(event: KeyboardEvent, shortcut: string): boolean {
  const parts = shortcut.toLowerCase().split("+");
  const key = parts.pop();
  if (!key || event.key.toLowerCase() !== key) return false;
  return parts.includes("ctrl") === event.ctrlKey && parts.includes("meta") === event.metaKey && parts.includes("alt") === event.altKey;
}

function MenuTitle({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        paddingTop: "var(--salt-spacing-100)",
        paddingLeft: "var(--salt-spacing-200)",
        paddingRight: "var(--salt-spacing-200)",
        paddingBottom: "var(--salt-spacing-50)",
      }}
    >
      <Text styleAs="label" color="secondary">
        <strong>{children}</strong>
      </Text>
    </div>
  );
}

function InfoItem({
  primary,
  secondary,
}: {
  primary: string;
  secondary?: string;
}) {
  return (
    <MenuItem>
      <StackLayout gap={0.5}>
        <Text>{primary}</Text>
        {secondary && (
          <Text styleAs="label" color="secondary">
            {secondary}
          </Text>
        )}
      </StackLayout>
    </MenuItem>
  );
}

function IconMenu({
  label,
  icon,
  children,
}: {
  label: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <Menu>
      <MenuTrigger>
        <Button appearance="transparent" aria-label={label}>
          {icon}
        </Button>
      </MenuTrigger>
      <MenuPanel aria-label={label}>{children}</MenuPanel>
    </Menu>
  );
}

/** The Global Search toolkit's field in the top bar; its shortcut focuses it. */
function GlobalSearch({ placeholder, shortcut }: { placeholder: string; shortcut: string }) {
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
  return (
    <Input
      placeholder={placeholder}
      startAdornment={<SearchIcon aria-hidden />}
      inputRef={field}
      inputProps={{ "aria-label": "Search", "aria-keyshortcuts": shortcut }}
      style={{ width: "calc(var(--salt-size-base) * 7)" }}
    />
  );
}

function NavGroup({
  icon,
  label,
  level = 0,
  defaultOpen = false,
  children,
}: {
  icon?: ReactNode;
  label: string;
  level?: number;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <li>
      <NavigationItem orientation="vertical" parent level={level} expanded={open} onExpand={() => setOpen((value) => !value)}>
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

/** An entry of the menu with nowhere to go in the demo. */
function StaticEntry({ children }: { children: ReactNode }) {
  return (
    <li
      style={{
        paddingTop: "var(--salt-spacing-100)",
        paddingBottom: "var(--salt-spacing-100)",
        paddingLeft: "calc(var(--salt-spacing-300) * 2)",
      }}
    >
      <Text color="secondary">{children}</Text>
    </li>
  );
}

export default function Shell({ children }: { children: ReactNode }) {
  const { current, routes } = useRoute();
  const navigate = useNavigate();
  const profile = useProfile();
  const { name: applicationName, environment } = useApplication();
  const experience = useExperience();
  const { mode } = useTheme();
  const [flyout, setFlyout] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const menuId = useId();
  const start = routes[0];

  const { portalName, logo, sidebar, footer, banner, headerSlots } = experience;
  const portalTitle = `${logo.alt} ${portalName}`;
  const logoSrc = mode === "dark" ? logo.dark : logo.light;

  const go =
    (route: PortalRoute | undefined) => (event: MouseEvent<HTMLElement>) => {
      event.preventDefault();
      setFlyout(false);
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
        if (!route) return <StaticEntry key={entry.id}>{entry.label}</StaticEntry>;
        return (
          <li key={entry.id}>
            <NavigationItem orientation="vertical" level={level} href={routeHref(route)} active={route.path === current.path} onClick={go(route)}>
              {level === 0 && <DocumentIcon aria-hidden />}
              {entry.label}
            </NavigationItem>
          </li>
        );
      });

  /** The flyout menu: Home, the application's routes, the Portal's menu, then Settings. */
  const flyoutMenu = (
    <nav id={menuId} aria-label={`${portalTitle} menu`}>
      <StackLayout gap={2}>
        <StackLayout as="ul" gap="var(--salt-spacing-fixed-100)" style={{ listStyle: "none", margin: 0, padding: 0 }}>
          <li>
            <NavigationItem orientation="vertical" href={start ? routeHref(start) : undefined} onClick={go(start)}>
              <HomeIcon aria-hidden />
              Home
            </NavigationItem>
          </li>
          <NavGroup icon={<FolderClosedIcon aria-hidden />} label={applicationName} defaultOpen>
            {routes.map((route) => (
              <li key={route.path}>
                <NavigationItem orientation="vertical" level={1} href={routeHref(route)} active={route.path === current.path} onClick={go(route)}>
                  {route.label}
                </NavigationItem>
              </li>
            ))}
          </NavGroup>
          {portalEntries(null, 0)}
        </StackLayout>
        <Divider />
        <FlexLayout align="center" gap={1}>
          <SettingsIcon aria-hidden />
          <Text color="secondary">Settings aren&apos;t part of the demo</Text>
        </FlexLayout>
      </StackLayout>
    </nav>
  );

  const brand = (
    <FlexLayout gap={1} align="center" as="span">
      <img src={logoSrc} alt={logo.alt} style={{ display: "block", height: "calc(var(--salt-size-base) * 0.8)", width: "auto" }} />
      <Text as="span" styleAs="h3" color="secondary">
        {portalName}
      </Text>
    </FlexLayout>
  );

  const headerSlot = (slot: string): ReactNode => {
    switch (slot) {
      case "toggle":
        return sidebar.shown ? (
          <Button key="toggle" appearance="transparent" aria-label="Open menu" title="Open menu" aria-expanded={flyout} aria-controls={menuId} onClick={() => setFlyout(true)}>
            <MenuIcon aria-hidden />
          </Button>
        ) : null;
      case "brand":
        return experience.logoLinksHome && start ? (
          <Link key="brand" href={routeHref(start)} onClick={go(start)} color="primary" underline="never">
            {brand}
          </Link>
        ) : (
          <span key="brand">{brand}</span>
        );
      case "global-search":
        return experience.search ? <GlobalSearch key="search" {...experience.search} /> : null;
      case "notifications":
        return experience.notifications ? (
          <IconMenu
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
          >
            <MenuTitle>{experience.notifications.title}</MenuTitle>
            <InfoItem primary="Two orders were filled" secondary="Today, 9:40" />
            <InfoItem primary="The September research pack is ready" secondary="Yesterday" />
          </IconMenu>
        ) : null;
      case "actions":
        return (
          <IconMenu key="help" label="Help" icon={<HelpCircleIcon aria-hidden />}>
            <MenuTitle>Help</MenuTitle>
            <InfoItem primary="Support Hub" secondary="Guides and contacts" />
            <InfoItem primary="Keyboard shortcuts" secondary="Press ? with the toolbar open" />
          </IconMenu>
        );
      case "feedback":
        return (
          <IconMenu key="feedback" label="Feedback" icon={<FeedbackIcon aria-hidden />}>
            <MenuTitle>Feedback</MenuTitle>
            <InfoItem primary={`Tell us about ${portalName}`} secondary="Feedback isn't sent anywhere in the demo." />
          </IconMenu>
        );
      case "user-menu":
        return (
          <div key="user" data-demo-anchor="portal-session">
            <Menu>
              <MenuTrigger>
                <Button appearance="transparent">
                  <FlexLayout gap={1} align="center" as="span">
                    <Avatar name={profile.name} size={1} aria-hidden />
                    <StackLayout gap={0} as="span" align="start">
                      <Text as="span">{profile.name}</Text>
                      <Text as="span" styleAs="label" color="secondary">
                        {`${profile.persona} · ${profile.region}`}
                      </Text>
                    </StackLayout>
                    <ChevronDownIcon aria-hidden />
                  </FlexLayout>
                </Button>
              </MenuTrigger>
              <MenuPanel aria-label={`User menu for ${profile.name}`}>
                <InfoItem primary={profile.name} secondary={`${profile.persona} · ${profile.region}`} />
                <InfoItem primary="The profile comes from the session context. Change it in the toolbar's Session tool." />
              </MenuPanel>
            </Menu>
          </div>
        );
      default:
        return null;
    }
  };

  // The slots after the brand sit after the sections, at the top bar's right end, in the experience's order.
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
    return (
      <Text key="tertiary" styleAs="label" color="secondary">
        {`Environment: ${environment ?? "Not set"}`}
      </Text>
    );
  };

  return (
    <StackLayout
      gap={0}
      style={{
        background: "var(--salt-container-primary-background)",
      }}
    >
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
      <header
        data-demo-anchor="portal-header"
        style={{
          background: "var(--salt-container-primary-background)",
          borderBottomWidth: "var(--salt-size-border)",
          borderBottomStyle: "solid",
          borderBottomColor: "var(--salt-separable-primary-borderColor)",
        }}
      >
        {/* Top bar */}
        {headerSlots.length > 0 && (
          <FlexLayout
            align="center"
            gap={2}
            wrap
            style={{
              paddingTop: "var(--salt-spacing-100)",
              paddingBottom: "var(--salt-spacing-100)",
              paddingLeft: "var(--salt-spacing-300)",
              paddingRight: "var(--salt-spacing-300)",
            }}
          >
            {leading.map(headerSlot)}

            <nav aria-label={`${portalTitle} sections`} data-scroll-x="" style={{ flexGrow: 1, flexShrink: 1, flexBasis: "calc(var(--salt-size-base) * 6)", minWidth: 0, overflowX: "auto" }}>
              <FlexLayout as="ul" gap={1} align="center" style={{ listStyle: "none", margin: 0, padding: 0, whiteSpace: "nowrap" }}>
                {SECTIONS.map((section) => (
                  <li key={section}>
                    <div
                      style={{
                        paddingLeft: "var(--salt-spacing-150)",
                        paddingRight: "var(--salt-spacing-150)",
                      }}
                    >
                      <Text color="secondary">{section}</Text>
                    </div>
                  </li>
                ))}
                {start && (
                  <li>
                    <NavigationItem href={routeHref(start)} orientation="horizontal" active aria-current="page" onClick={go(start)}>
                      {applicationName}
                    </NavigationItem>
                  </li>
                )}
              </FlexLayout>
            </nav>

            <FlexLayout gap={0.5} align="center">
              {trailing.map(headerSlot)}
            </FlexLayout>
          </FlexLayout>
        )}

        <Divider />

        {/* Route row */}
        <nav
          aria-label={`${portalTitle} navigation`}
          data-scroll-x=""
          style={{
            paddingLeft: "var(--salt-spacing-300)",
            paddingRight: "var(--salt-spacing-300)",
            overflowX: "auto",
          }}
        >
          <FlexLayout as="ul" gap={1} style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {routes.map((route) => {
              const isCurrent = route.path === current.path;
              return (
                <li key={route.path}>
                  <NavigationItem
                    href={routeHref(route)}
                    orientation="horizontal"
                    active={isCurrent}
                    aria-current={isCurrent ? "page" : undefined}
                    data-demo-anchor={`nav-${route.path}`}
                    onClick={go(route)}
                  >
                    {route.label}
                  </NavigationItem>
                </li>
              );
            })}
          </FlexLayout>
        </nav>
      </header>

      {sidebar.shown && (
        <Drawer open={flyout} onOpenChange={setFlyout} position="left" aria-label={`${portalTitle} menu`} style={{ width: "calc(var(--salt-size-base) * 9)" }}>
          <DrawerContent>{flyoutMenu}</DrawerContent>
        </Drawer>
      )}

      {/* Title band */}
      <div
        style={{
          background: "var(--salt-container-secondary-background)",
          borderBottomWidth: "var(--salt-size-border)",
          borderBottomStyle: "solid",
          borderBottomColor: "var(--salt-separable-primary-borderColor)",
          paddingTop: "var(--salt-spacing-400)",
          paddingBottom: "var(--salt-spacing-400)",
          paddingLeft: "var(--salt-spacing-300)",
          paddingRight: "var(--salt-spacing-300)",
        }}
      >
        <StackLayout gap={1}>
          <Text styleAs="label" color="secondary">
            {applicationName}
          </Text>
          <Text as="h1" styleAs="display2">
            {current.label}
          </Text>
        </StackLayout>
      </div>

      <main style={{ flex: 1, padding: "var(--salt-spacing-300)" }}>{children}</main>

      {footer.shown && (
        <footer
          data-demo-anchor="portal-footer"
          id="portal-footer"
          style={{
            background: "var(--salt-container-secondary-background)",
            borderTopWidth: "var(--salt-size-border)",
            borderTopStyle: "solid",
            borderTopColor: "var(--salt-separable-primary-borderColor)",
            padding: "var(--salt-spacing-300)",
          }}
        >
          <StackLayout gap={2}>
            <FlexLayout gap={3} align="center" wrap justify="space-between">
              <img src={logoSrc} alt={logo.alt} style={{ display: "block", height: "calc(var(--salt-size-base) * 0.8)", width: "auto" }} />
              <FlexLayout as="ul" gap={2} wrap aria-label="Legal" style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {FOOTER_LINKS.map((label) => (
                  <li key={label}>
                    <Text color="secondary">{label}</Text>
                  </li>
                ))}
              </FlexLayout>
            </FlexLayout>
            {footer.slots.length > 0 && (
              <FlexLayout gap={2} wrap justify="space-between">
                {footer.slots.map(footerSlot)}
              </FlexLayout>
            )}
          </StackLayout>
        </footer>
      )}
    </StackLayout>
  );
}
