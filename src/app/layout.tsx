// Global styles first: they declare the cascade layer order before any component stylesheet loads.
import "./globals.css";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { ToastProvider } from "@/components/ui/toast";
import { THEME_COOKIE, parseTheme } from "@/lib/web/theme";

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

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`} data-theme={theme === "system" ? undefined : theme}>
      <body>
        {/* Operator pages add the application shell in (operator)/layout.tsx; running demo applications render without it. */}
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
