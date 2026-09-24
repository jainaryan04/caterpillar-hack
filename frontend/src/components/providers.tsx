"use client";

import { useEffect, useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useUiStore } from "@/stores/ui-store";

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // No default polling: queries that move on their own (machines,
            // alerts, tasks, operators) set their own refetchInterval in
            // use-fleet-data.ts. Slow-moving data (zones, manuals) just
            // doesn't refetch until invalidated.
            staleTime: Infinity,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  useEffect(() => {
    void useUiStore.persist.rehydrate();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
        <TooltipProvider delayDuration={300}>
          {children}
          <Toaster position="bottom-right" visibleToasts={3} closeButton />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
