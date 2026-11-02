import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "@/components/worker/worker.css";

export const metadata: Metadata = {
  title: "מחסן · אפליקציית עובד",
  description: "קליטת סחורה, הוצאת סחורה ודיווח תקלות",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

/** Bare phone layout: no admin sidebar or topbar; pages centre themselves at var(--worker). */
export default function WorkerLayout({ children }: { children: ReactNode }) {
  return <div className="wk-root">{children}</div>;
}
