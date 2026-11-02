"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/** Rises into place the first time it scrolls into view. `i` staggers neighbours. */
export function Reveal({ i = 0, className, children }: { i?: number; className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setSeen(true);
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -6% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={ref} className={`cg-reveal${seen ? " is-in" : ""}${className ? ` ${className}` : ""}`} style={{ "--i": i } as React.CSSProperties}>
      {children}
    </div>
  );
}
