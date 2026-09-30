import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { NavLink } from "@/components/nav-link";
import "./globals.css";

// Every page reads live database state, so nothing is prerendered at build time.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { default: "Fabricate", template: "%s · Fabricate" },
  applicationName: "Fabricate",
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  colorScheme: "light dark",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <header className="app-header">
          <div className="app-header__inner">
            <Link href="/" className="app-brand" aria-label="Fabricate home">
              <svg className="app-brand__mark" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M12 2 22 20H2L12 2z" fill="currentColor" />
              </svg>
              <span className="app-brand__label">Fabricate</span>
            </Link>
            <nav aria-label="Primary">
              <NavLink href="/">Initiatives</NavLink>
              <NavLink href="/sources">Sources</NavLink>
              <NavLink href="/standards">Standards</NavLink>
            </nav>
          </div>
        </header>
        <main id="main" className="app-main" tabIndex={-1}>
          {children}
        </main>
      </body>
    </html>
  );
}
