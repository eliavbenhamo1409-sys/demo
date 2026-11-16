"use client";

/**
 * A notification tapped while the worker app is already open: the service worker (public/worker-sw.js)
 * moves a window it controls by itself, and asks any other window to go to the task through this.
 */
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function PushBridge(): null {
  const router = useRouter();
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const onMessage = (e: MessageEvent) => {
      const data = e.data as { type?: unknown; url?: unknown } | null;
      if (data?.type !== "open" || typeof data.url !== "string") return;
      const url = new URL(data.url, window.location.origin);
      if (url.origin !== window.location.origin || !url.pathname.startsWith("/worker")) return;
      router.push(url.pathname + url.search);
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    navigator.serviceWorker.startMessages();
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [router]);
  return null;
}
