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

/** Planted demo behavior: the deliberate defects the toolbar finds. */
export interface Planted {
  /** Occupies the main thread for +ms+ milliseconds: the one planted slow interaction. */
  blockMainThread(ms: number): void;
}
