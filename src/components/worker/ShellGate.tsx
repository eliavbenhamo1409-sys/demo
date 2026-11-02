"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { AppShell } from "@/components/app/AppShell";
import { ThumbZoom } from "@/components/app/ThumbZoom";
import { DataProvider } from "@/lib/store";

const under = (pathname: string, base: string) => pathname === base || pathname.startsWith(`${base}/`);

/** The catalogue brings its own data, the worker app renders bare, and everything else gets the admin shell. */
export function ShellGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (under(pathname, "/catalog")) return <>{children}</>;
  if (under(pathname, "/worker")) return <DataProvider>{children}</DataProvider>;
  return (
    <DataProvider>
      <AppShell>{children}</AppShell>
      <ThumbZoom />
    </DataProvider>
  );
}
