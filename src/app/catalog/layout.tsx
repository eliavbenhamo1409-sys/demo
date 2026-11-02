import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./catalog.css";
import { CatalogProvider } from "@/lib/catalog";
import { Shell } from "@/components/catalog/Shell";

export const metadata: Metadata = {
  title: "קטלוג",
  description: "מה שזמין עכשיו במחסן",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#ffffff",
};

/** The agents' site: its own look, its own data, no admin shell and no sign-in. */
export default function CatalogLayout({ children }: { children: ReactNode }) {
  return (
    <div className="cg-root">
      <CatalogProvider>
        <Shell>{children}</Shell>
      </CatalogProvider>
    </div>
  );
}
