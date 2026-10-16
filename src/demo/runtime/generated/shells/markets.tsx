import type { ReactNode, MouseEvent } from "react";
import {
  Avatar,
  Button,
  Divider,
  FlexLayout,
  Link,
  Menu,
  MenuItem,
  MenuPanel,
  MenuTrigger,
  NavigationItem,
  StackLayout,
  Text,
} from "@salt-ds/core";
import {
  AppSwitcherIcon,
  ChevronDownIcon,
  HelpCircleIcon,
  NotificationIcon,
  SearchIcon,
} from "@salt-ds/icons";
import {
  routeHref,
  useApplication,
  useNavigate,
  useProfile,
  useRoute,
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

export default function Shell({ children }: { children: ReactNode }) {
  const { current, routes } = useRoute();
  const navigate = useNavigate();
  const profile = useProfile();
  const { name: applicationName, portal, environment } = useApplication();
  const start = routes[0];

  const go =
    (route: (typeof routes)[number]) => (event: MouseEvent<HTMLElement>) => {
      event.preventDefault();
      navigate(route);
    };

  return (
    <StackLayout
      gap={0}
      style={{
        background: "var(--salt-container-primary-background)",
      }}
    >
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
          <Menu>
            <MenuTrigger>
              <Button appearance="transparent" aria-label="Switch applications">
                <AppSwitcherIcon aria-hidden />
              </Button>
            </MenuTrigger>
            <MenuPanel aria-label="Switch applications">
              <MenuTitle>Markets applications</MenuTitle>
              <InfoItem primary={applicationName} secondary="This application" />
            </MenuPanel>
          </Menu>

          {start && (
            <Link
              href={routeHref(start)}
              onClick={go(start)}
              aria-label={`${portal} home`}
              color="primary"
              underline="never"
            >
              <FlexLayout gap={1} align="baseline" as="span">
                <Text as="span" styleAs="h3">
                  <strong>J.P. Morgan</strong>
                </Text>
                <Text as="span" styleAs="h3" color="secondary">
                  Markets
                </Text>
              </FlexLayout>
            </Link>
          )}

          <nav aria-label={`${portal} sections`} data-scroll-x="" style={{ flex: "1 1 0", minWidth: 0, overflowX: "auto" }}>
            <FlexLayout
              as="ul"
              gap={1}
              align="center"
              style={{ listStyle: "none", margin: 0, padding: 0 }}
            >
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
                  <NavigationItem
                    href={routeHref(start)}
                    orientation="horizontal"
                    active
                    aria-current="page"
                    onClick={go(start)}
                  >
                    {applicationName}
                  </NavigationItem>
                </li>
              )}
            </FlexLayout>
          </nav>

          <FlexLayout gap={0.5} align="center">
            <IconMenu label="Search" icon={<SearchIcon aria-hidden />}>
              <MenuTitle>{`Search ${portal}`}</MenuTitle>
              <InfoItem
                primary="Search is not part of the demo"
                secondary="Use the application's own filters instead."
              />
            </IconMenu>
            <IconMenu label="Notifications" icon={<NotificationIcon aria-hidden />}>
              <MenuTitle>Notifications</MenuTitle>
              <InfoItem primary="Two payments need approval" secondary="Today, 9:40" />
              <InfoItem primary="September statements are ready" secondary="Yesterday" />
            </IconMenu>
            <IconMenu label="Help" icon={<HelpCircleIcon aria-hidden />}>
              <MenuTitle>Help</MenuTitle>
              <InfoItem primary="Support Hub" secondary="Guides and contacts" />
              <InfoItem
                primary="Keyboard shortcuts"
                secondary="Press ? with the toolbar open"
              />
            </IconMenu>

            <div data-demo-anchor="portal-session">
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
                  <InfoItem
                    primary={profile.name}
                    secondary={`${profile.persona} · ${profile.region}`}
                  />
                  <InfoItem primary="The profile comes from the session context. Change it in the toolbar's Session tool." />
                </MenuPanel>
              </Menu>
            </div>
          </FlexLayout>
        </FlexLayout>

        <Divider />

        {/* Route row */}
        <nav
          aria-label={`${portal} navigation`}
          data-scroll-x=""
          style={{
            paddingLeft: "var(--salt-spacing-300)",
            paddingRight: "var(--salt-spacing-300)",
            overflowX: "auto",
          }}
        >
          <FlexLayout
            as="ul"
            gap={1}
            style={{ listStyle: "none", margin: 0, padding: 0 }}
          >
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
            <Text styleAs="h3">
              <strong>J.P.Morgan</strong>
            </Text>
            <FlexLayout
              as="ul"
              gap={2}
              wrap
              aria-label="Legal"
              style={{ listStyle: "none", margin: 0, padding: 0 }}
            >
              {FOOTER_LINKS.map((label) => (
                <li key={label}>
                  <Text color="secondary">{label}</Text>
                </li>
              ))}
            </FlexLayout>
          </FlexLayout>
          <FlexLayout gap={2} wrap justify="space-between">
            <Text styleAs="label" color="secondary">
              {`An illustrative ${portal} shell for the template demo. All data is fictional.`}
            </Text>
            <Text styleAs="label" color="secondary">
              {`Environment: ${environment ?? "Not set"}`}
            </Text>
          </FlexLayout>
        </StackLayout>
      </footer>
    </StackLayout>
  );
}
