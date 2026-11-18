/**
 * The portal runtime interface, imported as `@deweb/portal`
 * (converge-templates-and-prototypes, design decision 5): what a hero's
 * microfrontends and shells may use besides React and Salt. The running
 * portal and the prototype frame each implement it.
 */

/** Who is using the application. */
export interface PortalProfile {
  readonly name: string;
  /** The persona, such as Analyst or Approver, that role-dependent content follows. */
  readonly persona: string;
  readonly region: string;
}

/** One of the application's routes, with the address that opens it. */
export interface PortalRoute {
  readonly path: string;
  readonly label: string;
  readonly href: string;
}

export interface PortalRoutes {
  readonly current: PortalRoute;
  readonly routes: readonly PortalRoute[];
}

/** The running application, for a shell to name. */
export interface PortalApplication {
  readonly name: string;
  /** The portal's name, such as J.P. Morgan Access, which its wordmark shows. */
  readonly portal: string;
  /** Production, Sandbox, or Dev, or null where there is no deployment. */
  readonly environment: string | null;
}

/** One entry of the portal's menu, groups before what they hold. */
export interface PortalMenuEntry {
  readonly id: string;
  readonly parentId: string | null;
  readonly kind: "group" | "item";
  readonly label: string;
  /** An item's route in the portal, such as /payees; null for a group. */
  readonly route: string | null;
}

/** The system message the banner shows. */
export interface PortalBanner {
  readonly title: string;
  readonly description: string;
  readonly severity: "info" | "warning" | "error";
  readonly dismissible: boolean;
}

/**
 * The portal's experience, as a shell renders it: the portal name beside the
 * logo, the banner, the header's slots in order, the menu and where it opens,
 * and the footer.
 */
export interface PortalExperience {
  readonly portalName: string;
  /** The logo images, light and dark, and the name they carry. */
  readonly logo: { readonly light: string; readonly dark: string; readonly alt: string };
  readonly logoLinksHome: boolean;
  readonly banner: PortalBanner | null;
  /** The header slots that render, in order: toggle, brand, global-search, actions, notifications, feedback, user-menu. */
  readonly headerSlots: readonly string[];
  readonly search: { readonly placeholder: string; readonly shortcut: string } | null;
  readonly notifications: { readonly title: string; readonly showUnread: boolean } | null;
  /** Whether the menu column renders, where the menu opens, and the sidebar slots that render, in order. */
  readonly sidebar: { readonly shown: boolean; readonly menuType: "left" | "flyout"; readonly slots: readonly string[] };
  readonly menu: readonly PortalMenuEntry[];
  /** Whether the footer renders, its slots in order, and the copyright its primary slot shows. */
  readonly footer: { readonly shown: boolean; readonly slots: readonly string[]; readonly copyright: string };
}
