import type { Metadata } from "next";
import "./globals.css";
import { DataProvider } from "@/lib/store";
import { ThemeProvider, THEME_BOOT_SCRIPT } from "@/lib/theme";
import { ShellGate } from "@/components/worker/ShellGate";

export const metadata: Metadata = {
  title: "ניהול מלאי · לוח ניהול",
  description: "סקירה, מלאי, תקלות, מילון ספקים וצוות של המפעל",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="he" dir="rtl" data-theme="light" className="h-full antialiased" suppressHydrationWarning>
      <head>
        {/* Applies the saved theme before first paint; see src/lib/theme.tsx. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body className="min-h-full">
        <ThemeProvider>
          <DataProvider>
            <ShellGate>{children}</ShellGate>
          </DataProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
