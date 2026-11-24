"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { useState, type ReactNode } from "react";
import { ThemeProvider } from "@/lib/client/theme/ThemeProvider";

export function Providers({ children }: { children: ReactNode }) {
  // Um client por montagem do navegador (evita compartilhar cache entre requisições no SSR).
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 60_000, refetchOnWindowFocus: false, retry: 1 } },
      }),
  );
  return (
    <ThemeProvider>
      <NuqsAdapter>
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      </NuqsAdapter>
    </ThemeProvider>
  );
}
