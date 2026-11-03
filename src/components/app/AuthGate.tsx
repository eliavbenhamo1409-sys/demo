"use client";

import { useEffect, useState, type ReactElement, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { SIGNED_OUT_ATTR } from "@/lib/login/boot";
import { supabase } from "@/lib/supabase/client";
import { LoginScreen } from "./LoginScreen";

type Status = "unknown" | "in" | "out";

/** The app for a signed-in person, the login for anyone else, at whatever URL they opened. The worker and catalogue have no sign-in of their own. */
export function AuthGate({ children }: { children: ReactNode }): ReactElement | null {
  const [status, setStatus] = useState<Status>("unknown");
  const pathname = usePathname();

  useEffect(() => {
    // Fires first with the stored session (INITIAL_SESSION), then on every change.
    // State only: a Supabase call inside this callback can deadlock.
    const { data } = supabase().auth.onAuthStateChange((_event, session) => {
      setStatus(session ? "in" : "out");
    });
    return () => data.subscription.unsubscribe();
  }, []);

  // The boot script's mark only bridges the wait for this answer; it must not follow anyone to the worker or the catalogue.
  useEffect(() => {
    if (status !== "unknown") document.documentElement.removeAttribute(SIGNED_OUT_ATTR);
  }, [status]);

  if (/^\/(worker|catalog)(\/|$)/.test(pathname)) return <>{children}</>;
  if (status === "unknown") return null;
  return status === "in" ? <>{children}</> : <LoginScreen />;
}
