import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { PushBridge } from "@/components/worker/PushBridge";
import "@/components/worker/worker.css";

export const metadata: Metadata = {
  title: "מחסן · אפליקציית עובד",
  description: "קליטת סחורה, הוצאת סחורה ודיווח תקלות",
  // Only the worker's pages can be added to a home screen; on an iPhone that is what lets them receive notifications.
  manifest: "/worker.webmanifest",
  appleWebApp: { capable: true, title: "מחסן", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

/** Bare phone layout: no admin sidebar or topbar; pages centre themselves at var(--worker). */
export default function WorkerLayout({ children }: { children: ReactNode }) {
  return (
    <div className="wk-root">
      <PushBridge />
      {children}
    </div>
  );
}
