"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import "./system-switch.css";

const SYSTEMS = [
  { href: "/", label: "לוח ניהול" },
  { href: "/worker", label: "עובד" },
  { href: "/catalog", label: "קטלוג" },
];

/** The three systems live on one site; the very bottom of every page moves between them. */
export function SystemSwitch() {
  const pathname = usePathname();
  const current = SYSTEMS.findLast((s) => pathname === s.href || pathname.startsWith(`${s.href}/`)) ?? SYSTEMS[0];
  return (
    <nav className="sys-switch" aria-label="מעבר בין המערכות">
      {SYSTEMS.map((s) => (
        <Link key={s.href} href={s.href} aria-current={s === current ? "page" : undefined}>{s.label}</Link>
      ))}
    </nav>
  );
}
