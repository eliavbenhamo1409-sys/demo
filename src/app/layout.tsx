import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider, THEME_BOOT_SCRIPT } from "@/lib/theme";
import { LOGIN_BOOT_SCRIPT } from "@/lib/login/boot";
import { AuthGate } from "@/components/app/AuthGate";
import { SystemSwitch } from "@/components/app/SystemSwitch";
import { ShellGate } from "@/components/worker/ShellGate";

export const metadata: Metadata = {
  title: "ניהול מלאי · לוח ניהול",
  description: "סקירה, מלאי, תקלות, מיפוי קטלוג וצוות של המחסן",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="he" dir="rtl" data-theme="minimal" className="h-full antialiased" suppressHydrationWarning>
      <head>
        {/* Applies the saved theme before first paint; see src/lib/theme.tsx. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: LOGIN_BOOT_SCRIPT }} />
      </head>
      <body className="min-h-full">
        <ThemeProvider>
          <AuthGate>
            <ShellGate>{children}</ShellGate>
          </AuthGate>
          <SystemSwitch />
        </ThemeProvider>
      </body>
    </html>
  );
}
