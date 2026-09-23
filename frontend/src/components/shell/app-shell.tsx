import type { ReactNode } from "react";
import { CommandSearch } from "./command-search";
import { MobileNav } from "./mobile-nav";
import { Sidebar } from "./sidebar";
import { SosBanner } from "./sos-banner";
import { TopBar } from "./top-bar";

/**
 * App frame — spec §5 / §20:
 *   SOS banner (only while an SOS is unacknowledged)
 *   Sidebar | TopBar
 *           | main (scrolls)
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-canvas">
      <a
        href="#main"
        className="sr-only z-50 bg-brand px-3 py-2 text-brand-foreground focus:not-sr-only focus:absolute focus:top-2 focus:left-2"
      >
        Skip to content
      </a>
      <SosBanner />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <MobileNav />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar />
          <main id="main" className="relative min-h-0 flex-1 overflow-y-auto">
            {children}
          </main>
        </div>
      </div>
      <CommandSearch />
    </div>
  );
}
