import { useEffect, useId, useState, type ReactNode, type MouseEvent } from "react";
import {
  Avatar,
  Button,
  Divider,
  Drawer,
  DrawerContent,
  FlexLayout,
  H1,
  Link,
  NavigationItem,
  Overlay,
  OverlayPanel,
  OverlayPanelContent,
  OverlayTrigger,
  StackLayout,
  Text,
} from "@salt-ds/core";
import {
  CallIcon,
  ChartLineIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  FolderClosedIcon,
  HelpCircleIcon,
  HomeIcon,
  MenuIcon,
  NotificationIcon,
  SearchIcon,
} from "@salt-ds/icons";
import { routeHref, useApplication, useNavigate, useProfile, useRoute } from "@deweb/portal";

const NARROW = "(max-width: 767px)";

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

type MenuEntry = { primary: string; secondary?: string };

function HeaderMenu({ label, icon, title, items }: { label: string; icon: ReactNode; title: string; items: MenuEntry[] }) {
  return (
    <Overlay placement="bottom">
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
          <Button appearance="transparent" aria-label={label}>
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

function NavGroup({
  icon,
  label,
  defaultOpen = false,
  containsCurrent = false,
  children,
}: {
  icon: ReactNode;
  label: string;
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
  const { current: currentRoute, routes } = useRoute();
  const navigate = useNavigate();
  const { name: applicationName, portal, environment } = useApplication();
  const narrow = useNarrow();
  const [collapsed, setCollapsed] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const navId = useId();

  const start = routes[0];
  const current = currentRoute ?? start;
  const expanded = narrow ? drawer : !collapsed;

  useEffect(() => {
    if (!narrow) setDrawer(false);
  }, [narrow]);

  const go = (event: MouseEvent, route: typeof start) => {
    event.preventDefault();
    setDrawer(false);
    if (route) navigate(route);
  };

  const navigation = (
    <nav id={navId} aria-label={`${portal} navigation`}>
      <StackLayout as="ul" gap="var(--salt-spacing-fixed-100)" style={{ listStyle: "none", margin: 0, padding: 0 }}>
        <li>
          <NavigationItem
            orientation="vertical"
            href={start ? routeHref(start) : undefined}
            onClick={(event: MouseEvent) => go(event, start)}
          >
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
        <NavGroup icon={<ChartLineIcon aria-hidden />} label="Reports and Insights">
          <StaticEntry>Statements</StaticEntry>
          <StaticEntry>Analytics</StaticEntry>
        </NavGroup>
        <NavGroup icon={<CallIcon aria-hidden />} label="Support Hub">
          <StaticEntry>Guides</StaticEntry>
          <StaticEntry>Contact us</StaticEntry>
        </NavGroup>
      </StackLayout>
    </nav>
  );

  return (
    <StackLayout gap={0} style={{ background: "var(--salt-container-primary-background)" }}>
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
          <Button
            appearance="transparent"
            aria-label={expanded ? "Hide navigation" : "Show navigation"}
            title={expanded ? "Hide navigation" : "Show navigation"}
            aria-expanded={expanded}
            aria-controls={navId}
            onClick={() => (narrow ? setDrawer((value) => !value) : setCollapsed((value) => !value))}
          >
            <MenuIcon aria-hidden />
          </Button>
          <Link
            href={start ? routeHref(start) : undefined}
            aria-label={`${portal} home`}
            onClick={(event: MouseEvent) => go(event, start)}
          >
            <FlexLayout as="span" align="center" gap={1}>
              <Text as="span" styleAs="h3">
                J.P.Morgan
              </Text>
              <Divider orientation="vertical" aria-hidden />
              <Text as="span" styleAs="h3" color="secondary">
                Access
              </Text>
            </FlexLayout>
          </Link>
        </FlexLayout>
        <FlexLayout align="center" gap={1}>
          <HeaderMenu
            label="Search"
            icon={<SearchIcon aria-hidden />}
            title={`Search ${portal}`}
            items={[{ primary: "Search is not part of the demo", secondary: "Use the application's own filters instead." }]}
          />
          <HeaderMenu
            label="Notifications"
            icon={<NotificationIcon aria-hidden />}
            title="Notifications"
            items={[
              { primary: "Two payments need approval", secondary: "Today, 9:40" },
              { primary: "September statements are ready", secondary: "Yesterday" },
            ]}
          />
          <HeaderMenu
            label="Help"
            icon={<HelpCircleIcon aria-hidden />}
            title="Help"
            items={[
              { primary: "Support Hub", secondary: "Guides and contacts" },
              { primary: "Keyboard shortcuts", secondary: "Press ? with the toolbar open" },
            ]}
          />
          <UserMenu compact={narrow} />
        </FlexLayout>
      </FlexLayout>

      <FlexLayout gap={0} align="stretch" style={{ flex: 1 }}>
        {!narrow && !collapsed && (
          <div
            style={{
              width: "calc(var(--salt-size-base) * 7)",
              flexShrink: 0,
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
        {narrow && (
          <Drawer
            open={drawer}
            onOpenChange={setDrawer}
            position="left"
            aria-label={`${portal} navigation`}
            style={{ width: "calc(var(--salt-size-base) * 8)" }}
          >
            <DrawerContent>{navigation}</DrawerContent>
          </Drawer>
        )}

        <StackLayout gap={0} style={{ flex: 1, minWidth: 0 }}>
          <StackLayout as="main" gap={2} padding={3} style={{ flex: 1 }}>
            <nav aria-label="Breadcrumb">
              <FlexLayout as="ol" align="center" gap={1} wrap style={{ listStyle: "none", margin: 0, padding: 0 }}>
                <FlexLayout as="li" align="center" gap={1}>
                  <Text color="secondary">{portal}</Text>
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
            <Text styleAs="label" color="secondary">
              {`An illustrative ${portal} shell for the template demo. All data is fictional.`}
            </Text>
            {environment && (
              <Text styleAs="label" color="secondary">
                {`Environment: ${environment}`}
              </Text>
            )}
          </FlexLayout>
        </StackLayout>
      </FlexLayout>
    </StackLayout>
  );
}
