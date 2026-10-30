import type { Metadata } from "next";
import "./globals.css";
import { DataProvider } from "@/lib/store";
import { AppShell } from "@/components/app/AppShell";

export const metadata: Metadata = {
  title: "Super Admin · ניהול מלאי",
  description: "סקירה, מלאי ומילון ספקים של המפעל",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="he" dir="rtl" data-theme="light" className="h-full antialiased">
      <body className="min-h-full">
        <DataProvider>
          <AppShell>{children}</AppShell>
        </DataProvider>
      </body>
    </html>
  );
}
