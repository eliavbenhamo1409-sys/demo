"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { AppShell } from "@/components/app/AppShell";

/** The worker app (/worker) renders bare; everything else gets the admin shell. */
export function ShellGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/worker" || pathname.startsWith("/worker/")) return <>{children}</>;
  return <AppShell>{children}</AppShell>;
}
