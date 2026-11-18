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
  DrawerHeader,
  FlexLayout,
  H1,
  Input,
  Kbd,
  Link,
  Menu,
  MenuGroup,
  MenuItem,
  MenuPanel,
  MenuTrigger,
  NavigationItem,
  SkipLink,
  StackLayout,
  Text,
  Tooltip,
  useBreakpoint,
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
import styles from "./markets.module.css";

/** Sections of the portal beside the application; only the application itself is part of the demo. */
const SECTIONS = ["Home", "Research", "Data & Analytics"] as const;
const FOOTER_LINKS = ["Terms of Use", "Disclosures", "Security", "Privacy", "Cookies Policy", "Contact Us"] as const;

/** The shell's edges: Salt's spacing-200 on small screens and spacing-300 from md up, with the block spacing given. */
const inset = (block: string) => ({ xs: `${block} var(--salt-spacing-200)`, md: `${block} var(--salt-spacing-300)` });
const GUTTER = { xs: 2, md: 3 } as const;

/**
 * Below Salt's md breakpoint the user menu shows only its avatar.
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

function InfoItem({ primary, secondary }: { primary: string; secondary?: string }) {
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

/** A header action: an icon button, named by its tooltip while closed, that opens a menu. */
function IconMenu({ label, icon, children }: { label: string; icon: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Menu open={open} onOpenChange={setOpen}>
      <Tooltip content={label} placement="bottom" disabled={open}>
        <MenuTrigger>
          <Button appearance="transparent" aria-label={label}>
            {icon}
          </Button>
        </MenuTrigger>
      </Tooltip>
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
      endAdornment={<Kbd aria-hidden>{shortcut}</Kbd>}
      inputRef={field}
      inputProps={{ "aria-label": "Search", "aria-keyshortcuts": shortcut }}
      className={styles.search}
    />
  );
}

/** A menu group: a parent navigation item that expands to the entries it holds. */
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
    <StackLayout as="li" gap="var(--salt-spacing-fixed-100)">
      <NavigationItem orientation="vertical" parent level={level} expanded={open} onExpand={() => setOpen((value) => !value)}>
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
  const { current, routes } = useRoute();
  const navigate = useNavigate();
  const profile = useProfile();
  const { name: applicationName, environment } = useApplication();
  const experience = useExperience();
  const { mode } = useTheme();
  const compact = useCompact();
  const [flyout, setFlyout] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const menuId = useId();
  const mainId = useId();
  const start = routes[0];

  const { portalName, logo, sidebar, footer, banner, headerSlots } = experience;
  const portalTitle = `${logo.alt} ${portalName}`;
  const logoSrc = mode === "dark" ? logo.dark : logo.light;
  const role = `${profile.persona} · ${profile.region}`;

  const go = (route: PortalRoute | undefined) => (event: MouseEvent<HTMLElement>) => {
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
        if (!route) {
          return (
            <StaticEntry key={entry.id} level={level}>
              {entry.label}
            </StaticEntry>
          );
        }
        return (
          <FlexLayout as="li" key={entry.id} gap={0}>
            <NavigationItem orientation="vertical" level={level} href={routeHref(route)} active={route.path === current.path} onClick={go(route)}>
              {level === 0 && <DocumentIcon aria-hidden />}
              {entry.label}
            </NavigationItem>
          </FlexLayout>
        );
      });

  /** The flyout menu: Home, the application's routes, the Portal's menu, then Settings. */
  const flyoutMenu = (
    <StackLayout as="nav" id={menuId} aria-label={`${portalTitle} menu`} gap={2}>
      <StackLayout as="ul" gap="var(--salt-spacing-fixed-100)" className={styles.list}>
        <FlexLayout as="li" gap={0}>
          <NavigationItem orientation="vertical" href={start ? routeHref(start) : undefined} onClick={go(start)}>
            <HomeIcon aria-hidden />
            Home
          </NavigationItem>
        </FlexLayout>
        <NavGroup icon={<FolderClosedIcon aria-hidden />} label={applicationName} defaultOpen>
          {routes.map((route) => (
            <FlexLayout as="li" key={route.path} gap={0}>
              <NavigationItem orientation="vertical" level={1} href={routeHref(route)} active={route.path === current.path} onClick={go(route)}>
                {route.label}
              </NavigationItem>
            </FlexLayout>
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
  );

  const brand = (
    <>
      <img src={logoSrc} alt={logo.alt} width={132} height={28} className={styles.logo} />
      <Text styleAs="h3" color="secondary">
        {portalName}
      </Text>
    </>
  );

  const headerSlot = (slot: string): ReactNode => {
    switch (slot) {
      case "toggle":
        return sidebar.shown ? (
          <Tooltip key="toggle" content="Open menu" placement="bottom" disabled={flyout}>
            <Button appearance="transparent" aria-label="Open menu" aria-expanded={flyout} aria-controls={menuId} onClick={() => setFlyout(true)}>
              <MenuIcon aria-hidden />
            </Button>
          </Tooltip>
        ) : null;
      case "brand":
        return experience.logoLinksHome && start ? (
          <Link key="brand" href={routeHref(start)} onClick={go(start)} color="primary" underline="never" className={styles.brand}>
            {brand}
          </Link>
        ) : (
          <FlexLayout key="brand" align="center" gap={1}>
            {brand}
          </FlexLayout>
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
            <MenuGroup label={experience.notifications.title}>
              <InfoItem primary="Two orders were filled" secondary="Today, 9:40" />
              <InfoItem primary="The September research pack is ready" secondary="Yesterday" />
            </MenuGroup>
          </IconMenu>
        ) : null;
      case "actions":
        return (
          <IconMenu key="help" label="Help" icon={<HelpCircleIcon aria-hidden />}>
            <MenuGroup label="Help">
              <InfoItem primary="Support Hub" secondary="Guides and contacts" />
              <InfoItem primary="Keyboard shortcuts" secondary="Press ? with the toolbar open" />
            </MenuGroup>
          </IconMenu>
        );
      case "feedback":
        return (
          <IconMenu key="feedback" label="Feedback" icon={<FeedbackIcon aria-hidden />}>
            <MenuGroup label="Feedback">
              <InfoItem primary={`Tell us about ${portalName}`} secondary="Feedback isn't sent anywhere in the demo." />
            </MenuGroup>
          </IconMenu>
        );
      case "user-menu":
        return (
          <Menu key="user">
            <MenuTrigger>
              <Button appearance="transparent" aria-label={compact ? `User menu for ${profile.name}` : undefined} data-demo-anchor="portal-session">
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
            </MenuTrigger>
            <MenuPanel aria-label={`User menu for ${profile.name}`}>
              <InfoItem primary={profile.name} secondary={role} />
              <InfoItem primary="The profile comes from the session context. Change it in the toolbar's Session tool." />
            </MenuPanel>
          </Menu>
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
      <StackLayout as="header" gap={0} data-demo-anchor="portal-header" className={styles.header}>
        {/* Top bar: the menu control and brand, the portal's sections, then the header actions. */}
        {headerSlots.length > 0 && (
          <>
            <FlexLayout align="center" gap={2} wrap padding={inset("var(--salt-spacing-100)")}>
              {leading.map(headerSlot)}
              <FlexLayout as="nav" aria-label={`${portalTitle} sections`} data-scroll-x="" gap={0} className={styles.sections}>
                <FlexLayout as="ul" gap={1} align="center" className={styles.tabs}>
                  {SECTIONS.map((section) => (
                    <FlexLayout as="li" key={section} gap={0}>
                      <Text color="secondary" className={styles.section}>
                        {section}
                      </Text>
                    </FlexLayout>
                  ))}
                  {start && (
                    <FlexLayout as="li" gap={0}>
                      <NavigationItem href={routeHref(start)} orientation="horizontal" active onClick={go(start)}>
                        {applicationName}
                      </NavigationItem>
                    </FlexLayout>
                  )}
                </FlexLayout>
              </FlexLayout>
              <FlexLayout gap={0.5} align="center">
                {trailing.map(headerSlot)}
              </FlexLayout>
            </FlexLayout>
            <Divider />
          </>
        )}

        {/* Route row: the application's routes as tabs. */}
        <FlexLayout as="nav" aria-label={`${portalTitle} navigation`} data-scroll-x="" gap={0} padding={inset("0")} className={styles.routes}>
          <FlexLayout as="ul" gap={1} className={styles.tabs}>
            {routes.map((route) => (
              <FlexLayout as="li" key={route.path} gap={0}>
                <NavigationItem href={routeHref(route)} orientation="horizontal" active={route.path === current.path} data-demo-anchor={`nav-${route.path}`} onClick={go(route)}>
                  {route.label}
                </NavigationItem>
              </FlexLayout>
            ))}
          </FlexLayout>
        </FlexLayout>
      </StackLayout>

      {sidebar.shown && (
        // The drawer opens on the menu's first entry, after its close button.
        <Drawer open={flyout} onOpenChange={setFlyout} position="left" initialFocus={1} className={styles.drawer}>
          <DrawerHeader
            header={portalName}
            actions={
              <Button appearance="transparent" aria-label="Close menu" onClick={() => setFlyout(false)}>
                <CloseIcon aria-hidden />
              </Button>
            }
          />
          <DrawerContent>{flyoutMenu}</DrawerContent>
        </Drawer>
      )}

      <StackLayout as="main" id={mainId} tabIndex={-1} gap={0} className={styles.main}>
        {/* Title band */}
        <StackLayout gap={0} padding={{ xs: "var(--salt-spacing-300) var(--salt-spacing-200)", md: "var(--salt-spacing-400) var(--salt-spacing-300)" }} className={styles.band}>
          <StackLayout gap={1}>
            <Text styleAs="label" color="secondary">
              {applicationName}
            </Text>
            <H1 styleAs="display2">{current.label}</H1>
          </StackLayout>
        </StackLayout>
        <StackLayout gap={0} padding={GUTTER}>
          {children}
        </StackLayout>
      </StackLayout>

      {footer.shown && (
        <StackLayout as="footer" data-demo-anchor="portal-footer" id="portal-footer" gap={2} padding={GUTTER} className={styles.footer}>
          <FlexLayout gap={3} align="center" wrap justify="space-between">
            <img src={logoSrc} alt={logo.alt} width={132} height={28} className={styles.logo} />
            <FlexLayout as="ul" gap={2} wrap aria-label="Legal" className={styles.list}>
              {FOOTER_LINKS.map((label) => (
                <FlexLayout as="li" key={label} gap={0}>
                  <Text color="secondary">{label}</Text>
                </FlexLayout>
              ))}
            </FlexLayout>
          </FlexLayout>
          {footer.slots.length > 0 && (
            <FlexLayout gap={2} wrap justify="space-between">
              {footer.slots.map(footerSlot)}
            </FlexLayout>
          )}
        </StackLayout>
      )}
    </StackLayout>
  );
}
